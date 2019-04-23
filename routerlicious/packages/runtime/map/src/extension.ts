import { ISharedObjectExtension } from "@prague/api-definitions";
import { IComponentRuntime, IDistributedObjectServices } from "@prague/runtime-definitions";
import { ISharedMap, IValueType } from "./interfaces";
import { SharedMap } from "./map";

// register default types
const defaultValueTypes = new Array<IValueType<any>>();
export function registerDefaultValueType(type: IValueType<any>) {
    defaultValueTypes.push(type);
}

/**
 * The extension that defines the map
 */
export class MapExtension implements ISharedObjectExtension {
    public static Type = "https://graph.microsoft.com/types/map";

    public type: string = MapExtension.Type;
    public readonly snapshotFormatVersion: string = "0.1";

    public async load(
        runtime: IComponentRuntime,
        id: string,
        minimumSequenceNumber: number,
        services: IDistributedObjectServices,
        headerOrigin: string): Promise<ISharedMap> {

        const map = new SharedMap(id, runtime, MapExtension.Type);
        this.registerValueTypes(map, defaultValueTypes);
        await map.load(minimumSequenceNumber, headerOrigin, services);

        return map;
    }

    public create(document: IComponentRuntime, id: string): ISharedMap {
        const map = new SharedMap(id, document, MapExtension.Type);
        this.registerValueTypes(map, defaultValueTypes);
        map.initializeLocal();

        return map;
    }

    private registerValueTypes(map: SharedMap, valueTypes: Array<IValueType<any>>) {
        for (const type of valueTypes) {
            map.registerValueType(type);
        }
    }
}
