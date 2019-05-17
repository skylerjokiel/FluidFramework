import { KeyCode, Scheduler } from "@prague/flow-util";
import { ISegment } from "@prague/merge-tree";
import { IViewState, View } from "..";
import { SequenceDeltaEvent } from "../../../../../runtime/sequence/dist";
import { debug } from "../../debug";
import { IPaginationProvider, PagePosition } from "../../pagination";
import { DocumentView, IDocumentProps } from "../document";
import { shouldIgnoreEvent } from "../inclusion";
import { Cursor } from "./cursor";
import * as style from "./index.css";

export interface IEditorProps extends IDocumentProps {
    scheduler: Scheduler;
    eventSink?: HTMLElement;
}

interface IListenerRegistration {
    target: EventTarget;
    type: string;
    listener: EventListener;
}

interface IEditorViewState extends IViewState {
    cursor: Cursor;
    docView: DocumentView;
    eventSink: Element;
    props: IEditorProps;
    listeners: IListenerRegistration[];
}

export class Editor extends View<IEditorProps, IEditorViewState> implements IPaginationProvider {
    private get cursor()         { return this.state.cursor; }
    public  get doc()            { return this.state.props.doc; }
    private get props()          { return this.state.props; }
    public  get cursorPosition() { return this.state.cursor.position; }
    public invalidate?: () => void;

    constructor() {
        super();
    }

    public paginate(start: PagePosition, budget: number) {
        Object.assign(this.props, { start, paginationBudget: budget });
        this.update(this.props);
        return this.state.docView.paginationStop;
    }

    protected mounting(props: Readonly<IEditorProps>): IEditorViewState {
        const scheduler = props.scheduler;
        this.invalidate = scheduler.coalesce(scheduler.onLayout, this.render);

        const cursor = new Cursor(props.doc);
        cursor.moveTo(0, false);

        const docView = new DocumentView();
        const root = docView.mount(props);
        docView.overlay.appendChild(cursor.root);

        const listeners: IListenerRegistration[] = [];
        const eventSink = props.eventSink || root;
        this.on(listeners, eventSink, "keydown",   this.onKeyDown);
        this.on(listeners, eventSink, "keypress",  this.onKeyPress);
        this.on(listeners, eventSink, "mousedown", this.onMouseDown);
        this.on(listeners, window,    "resize",    this.invalidate);

        props.doc.on("sequenceDelta", (e: SequenceDeltaEvent) => {
            const { start, end } = this.state.docView.range;
            if (start < e.end && e.start < end) {
                this.invalidate();
            }
        });

        return this.updating(props, {
            root,
            listeners,
            docView,
            eventSink,
            props,
            cursor,
        });
    }

    protected updating(props: Readonly<IEditorProps>, state: IEditorViewState): IEditorViewState {
        // If the document has changed, remount the document view.
        if (props.doc !== state.props.doc) {
            this.unmounting(state);
            state = this.mounting(props);
        }

        state.docView.update(props);

        return state;
    }

    protected unmounting(state: IEditorViewState): void {
        for (const listener of state.listeners) {
            listener.target.removeEventListener(listener.type, listener.listener);
        }

        this.doc.off("sequenceDelta", this.invalidate);
    }

    private on<K extends keyof HTMLElementEventMap>(listeners: IListenerRegistration[], target: EventTarget, type: K | string, listener: (ev: HTMLElementEventMap[K]) => any) {
        const wrappedListener = (e: Event) => {
            // Ignore events that bubble up from inclusions
            if (shouldIgnoreEvent(e)) {
                return;
            }

            listener(e);
        };

        target.addEventListener(type, wrappedListener);
        listeners.push({ target, type, listener: wrappedListener });
    }

    private readonly render = () => {
        this.props.trackedPositions = this.cursor.getTracked();
        this.state.docView.update(this.props);
        this.cursor.render();
    }

    private delete(deltaStart: number, deltaEnd: number) {
        const start = this.cursor.selectionStart;
        const end = this.cursor.position;

        if (start === end) {
            // If no range is currently selected, delete the preceding character (if any).
            this.doc.remove(start + deltaStart, end + deltaEnd);
        } else {
            // Otherwise, delete the selected range.
            this.doc.remove(Math.min(start, end), Math.max(start, end));
        }
    }

    private insertText(text: string) {
        const start = this.cursor.selectionStart;
        const end = this.cursor.position;
        if (start === end) {
            this.doc.insertText(end, text);
        } else {
            this.doc.replaceWithText(Math.min(start, end), Math.max(start, end), text);
        }
    }

    private horizontalArrow(ev: KeyboardEvent, deltaX: number) {
        this.cursor.moveBy(deltaX, ev.shiftKey);
        this.invalidate();
        ev.preventDefault();
        ev.stopPropagation();
    }

    private verticalArrow(ev: KeyboardEvent, searchFn: (x: number, top: number, bottom: number) => { segment: ISegment, offset: number} | undefined) {
        const cursorBounds = this.cursor.bounds;
        if (cursorBounds) {
            const segmentAndOffset = searchFn(cursorBounds.left, cursorBounds.top, cursorBounds.bottom);
            if (segmentAndOffset) {
                const position = this.doc.getPosition(segmentAndOffset.segment);
                this.cursor.moveTo(position + segmentAndOffset.offset, ev.shiftKey);
                this.invalidate();
                ev.preventDefault();
                ev.stopPropagation();
            }
        }
    }

    private readonly onKeyDown = (ev: KeyboardEvent) => {
        const keyCode = ev.code;
        switch (keyCode) {
            // Note: Chrome 69 delivers backspace on 'keydown' only (i.e., 'keypress' is not fired.)
            case KeyCode.Backspace: {
                this.delete(-1, 0);
                ev.preventDefault();
                ev.stopPropagation();
                break;
            }
            case KeyCode.Delete: {
                this.delete(0, 1);
                ev.preventDefault();
                ev.stopPropagation();
                break;
            }
            case KeyCode.ArrowLeft: {
                this.horizontalArrow(ev, -1);
                break;
            }
            case KeyCode.ArrowRight: {
                this.horizontalArrow(ev, +1);
                break;
            }
            case KeyCode.ArrowDown: {
                this.verticalArrow(ev, this.state.docView.findBelow);
                break;
            }
            case KeyCode.ArrowUp: {
                this.verticalArrow(ev, this.state.docView.findAbove);
                break;
            }
            default: {
                debug(`Key: ${ev.key} (${ev.keyCode})`);
            }
        }
    }

    private readonly onKeyPress = (ev: KeyboardEvent) => {
        if (ev.ctrlKey) {
            switch (ev.key) {
                case "b":
                    this.doc.toggleCssClass(this.cursor.selectionStart, this.cursor.position, style.bold);
                    ev.stopPropagation();
                    ev.preventDefault();
                    return;
                case "i":
                    this.doc.toggleCssClass(this.cursor.selectionStart, this.cursor.position, style.italic);
                    ev.stopPropagation();
                    ev.preventDefault();
                    return;
                case "u":
                    this.doc.toggleCssClass(this.cursor.selectionStart, this.cursor.position, style.underline);
                    ev.stopPropagation();
                    ev.preventDefault();
                    return;
                default:
            }
        }

        switch (ev.code) {
            case KeyCode.Backspace: {
                // Note: Backspace handled on 'keydown' event to support Chrome 69 (see comment in 'onKeyDown').
                break;
            }
            case KeyCode.Enter: {
                if (ev.shiftKey) {
                    this.doc.insertLineBreak(this.cursor.position);
                } else {
                    this.doc.insertParagraph(this.cursor.position);
                }
                ev.stopPropagation();
                break;
            }
            default: {
                this.insertText(ev.key);
                ev.stopPropagation();
                ev.preventDefault();
            }
        }
    }

    private readonly onMouseDown = (ev: MouseEvent) => {
        const maybeSegmentAndOffset = this.state.docView.hitTest(ev.x, ev.y);
        if (maybeSegmentAndOffset) {
            const { segment, offset } = maybeSegmentAndOffset;
            const position = Math.min(
                this.doc.getPosition(segment) + offset,
                this.doc.length - 1);
            this.cursor.moveTo(position, false);
            this.invalidate();
            ev.stopPropagation();
        }
    }
}
