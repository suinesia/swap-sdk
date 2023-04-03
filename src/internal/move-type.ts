import { normalizeSuiObjectId as nid } from "@mysten/sui.js";

export class MoveType {
    public package: string;
    public module: string;
    public field: string;

    static equals = (a: MoveType, b: MoveType) => {
        return a.package === b.package && a.module === b.module && a.field === b.field;
    }

    static fromString = (s: string) => {
        const sp = s.split("::");
        if (sp.length !== 3) {
            return null;
        }

        return new MoveType({ package: nid(sp[0]), module: sp[1], field: sp[2] });
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
        return `CoinType[${this.str()}]`;
    }
}