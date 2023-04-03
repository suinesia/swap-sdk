import { normalizeSuiObjectId as nid } from "@mysten/sui.js";

export class MoveType {
    public package: string;
    public module: string;
    public field: string;

    static equals = (a: MoveType, b: MoveType) => {
        return a.package === b.package && a.module === b.module && a.field === b.field;
    }

    static fromString = (s: string) => {
        const regex = /^([^:]+)::([^:]+)::((?:[^:]|::)+)$/;
        const match = s.trim().match(regex);

        if (match) {
          return new MoveType({ package: match[1], module: match[2], field: match[3] });
        }
        
        return null;
    }

    constructor(p: { package: string, module: string, field: string}) {
        this.package = nid(p.package);
        this.module = p.module;
        this.field = p.field;
    }

    str = () => {
        return `${this.package}::${this.module}::${this.field}`;
    }

    uuid = () => {
        return `MoveType[${this.str()}]`;
    }
}