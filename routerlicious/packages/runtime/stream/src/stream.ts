import {
    FileMode,
    ISequencedDocumentMessage,
    ITree,
    MessageType,
    TreeEntry,
} from "@prague/container-definitions";
import { SharedMap } from "@prague/map";
import {
    IComponentRuntime,
    IObjectStorageService,
} from "@prague/runtime-definitions";
import { StreamExtension } from "./extension";
import { IDelta, IInkLayer, IStream } from "./interfaces";
import { ISnapshot, Snapshot } from "./snapshot";

/**
 * Map snapshot definition
 */
export interface IInkSnapshot {
    minimumSequenceNumber: number;
    sequenceNumber: number;
    snapshot: ISnapshot;
}

const snapshotFileName = "header";

const emptySnapshot: ISnapshot = { layers: [], layerIndex: {} };

export class Stream extends SharedMap implements IStream {
    // The current ink snapshot
    private inkSnapshot: Snapshot;

    constructor(runtime: IComponentRuntime, id: string) {
        super(id, runtime, StreamExtension.Type);
    }

    public getLayers(): IInkLayer[] {
        return this.inkSnapshot.layers;
    }

    public getLayer(key: string): IInkLayer {
        return this.inkSnapshot.layers[this.inkSnapshot.layerIndex[key]];
    }

    public submitOp(op: IDelta) {
        this.submitLocalMessage(op);
        this.inkSnapshot.apply(op);
    }

    protected async loadContent(
        minimumSequenceNumber: number,
        headerOrigin: string,
        storage: IObjectStorageService): Promise<void> {

        const header = await storage.read(snapshotFileName);
        /* tslint:disable:no-unsafe-any */
        const data: ISnapshot = header
            ? JSON.parse(Buffer.from(header, "base64")
                .toString("utf-8"))
            : emptySnapshot;
        this.initialize(data);
    }

    protected initializeContent() {
        this.initialize(emptySnapshot);
    }

    protected snapshotContent(): ITree {
        const tree: ITree = {
            entries: [
                {
                    mode: FileMode.File,
                    path: snapshotFileName,
                    type: TreeEntry[TreeEntry.Blob],
                    value: {
                        contents: JSON.stringify(this.inkSnapshot),
                        encoding: "utf-8",
                    },
                },
            ],
            sha: null,
        };

        return tree;
    }

    protected processContent(message: ISequencedDocumentMessage, local: boolean) {
        if (message.type === MessageType.Operation && !local) {
            this.inkSnapshot.apply(message.contents as IDelta);
        }
    }

    protected onConnectContent(pending: any[]) {
        // Stream can resend messages under new client id
        for (const message of pending) {
            this.submitLocalMessage(message);
        }

        return;
    }

    private initialize(data: ISnapshot) {
        this.inkSnapshot = Snapshot.Clone(data);
    }
}
