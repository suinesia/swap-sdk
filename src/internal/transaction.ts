import { AddressType, PoolInfo, PoolDirectionType, PositionInfo } from "./common";

export type TransacationNormalizedArgument = ["address" | "string" | "object", string] | ["u8" | "u64" | "u128" | "u256", number | bigint];
export type TransacationArgument = TransacationNormalizedArgument;

export type TransactionOperationType_SwapType = "swap";
export type TransactionOperationType_AddLiquidityType = "add-liquidity";
export type TransactionOperationType_RemoveLiquidityType = "remove-liquidity";
export type TransactionOperationType_RawType = "raw";

export interface TransactionType {
    function: string;
    type_arguments: string[];
    arguments: TransacationArgument[];
}

export interface TransactionTypeSerializeContext {
    packageAddr: AddressType;
    sender: AddressType;
}

export interface TransactionOptions {
    maxGasAmount?: bigint;
    gasUnitPrice?: bigint;
    expirationSecond?: number;
}

export interface TransactionOperation_SwapProps {
    operation: TransactionOperationType_SwapType;
    pool: PoolInfo;
    direction: PoolDirectionType;
    amount: bigint;
    minOutputAmount?: bigint;
};

export interface TransactionOperation_AddLiquidityProps {
    operation: TransactionOperationType_AddLiquidityType;
    pool: PoolInfo;
    xAmount: bigint;
    yAmount: bigint;
    unlockEpoch: bigint;
};

export interface TransactionOperation_RemoveLiquidityProps {
    operation: TransactionOperationType_RemoveLiquidityType;
    positionInfo: PositionInfo
}

export interface TransactionOperation_Raw {
    operation: TransactionOperationType_RawType;
    transaction: TransactionType;
}

export type TransactionOperation_Any = (
    TransactionOperation_SwapProps | 
    TransactionOperation_AddLiquidityProps |
    TransactionOperation_RemoveLiquidityProps | 
    TransactionOperation_Raw
);

export type TransactionOperationType_AnyType = (
    TransactionOperationType_SwapType | 
    TransactionOperationType_AddLiquidityType |
    TransactionOperationType_RemoveLiquidityType | 
    TransactionOperationType_RawType
);

export declare namespace TransactionOperation {
    export {
        TransactionOperation_SwapProps as Swap,
        TransactionOperation_AddLiquidityProps as AddLiquidity,
        TransactionOperation_RemoveLiquidityProps as RemoveLiquidity,
        TransactionOperation_Raw as Raw,
        TransactionOperation_Any as Any,

        TransactionOperationType_SwapType as SwapType,
        TransactionOperationType_AddLiquidityType as AddLiquidityType,
        TransactionOperationType_RemoveLiquidityType as RemoveLiquidityType,
        TransactionOperationType_RawType as RawType,
        TransactionOperationType_AnyType as AnyType
    }
}

export class TransactionArgumentHelper {
    static normalizeTransactionArgument = (v: TransacationArgument, ctx: TransactionTypeSerializeContext) => {
        // Speical hanlding for address
        if (v[0] === "address" || v[0] === "object") {
            let valueStr = v[1].toString();
    
            // Use @ to replace current package addr
            if (valueStr === "@") {
               v[1] = ctx.packageAddr;
            }
            else if (valueStr === "$sender") {
                v[1] = ctx.sender;
            }
        }
        return v as TransacationNormalizedArgument;
    }
}