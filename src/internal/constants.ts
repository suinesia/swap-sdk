import { MoveType } from "./move-type";

export class BigIntConstants {
    static ZERO = BigInt(0);

    static _1E0 = BigInt(1);
    static _1E1 = BigInt(10 ** 1);
    static _1E2 = BigInt(10 ** 2);
    static _1E3 = BigInt(10 ** 3);
    static _1E4 = BigInt(10 ** 4);
    static _1E5 = BigInt(10 ** 5);
    static _1E6 = BigInt(10 ** 6);
    static _1E7 = BigInt(10 ** 7);
    static _1E8 = BigInt(10 ** 8);
    static _1E9 = BigInt(10 ** 9);

    static FOUR = BigInt(4);
    static THREE = BigInt(3);
    static TWO = BigInt(2);
    static ONE = BigInt(1);

    static MINUS_ONE = BigInt(-1);
}

export class DateConstants {
    static MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
}

export class NumberLimit {
    static U64_MAX = BigInt("18446744073709551615");
}

export enum ChainNames {
    SUI_DEVNET = 'sui:devnet',
    SUI_TESTNET = 'sui:testnet',
    SUI_MAINNET = 'sui:mainnet'
}

export class SuiConstants {    
    static SUI_COIN_NAME = "0x2::sui::SUI";
    static SUI_COIN_TYPE = new MoveType({package: "0x2", module: "sui", field: "SUI"});
}