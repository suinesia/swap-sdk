import {  PoolInfo, CoinType, CoinInfo, AddressType, TxHashType, PositionInfo, CommonTransaction, EndPointType } from './common';
import { TransactionOperation } from './transaction';

export enum ClientFeatures {
    SupportMultiCoins = "SupportMultiCoins",
    SeparateGasCoin = "SeparateGasCoin"
}

export abstract class Client {
    abstract getPackageAddress: () => AddressType;
    abstract getCoinsAndPools: () => Promise<{ coins: CoinType[], pools: PoolInfo[] }>;
    abstract getPool: (poolInfo: PoolInfo) => Promise<PoolInfo | null>;
    abstract getPosition: (positionInfo: PositionInfo, pools: PoolInfo[]) => Promise<PositionInfo | null>;

    abstract getAccountCoins: (accountAddr: AddressType, filter?: Array<string>) => Promise<CoinInfo[]>;
    abstract getExplorerHrefForTxHash?: (txHash: TxHashType, endPointType?: EndPointType) => string;
    abstract getPrimaryCoinType: () => CoinType;
    abstract getTransactions: (accountAddr: AddressType, limit: number, pools?: PoolInfo[]) => Promise<CommonTransaction[]>;
    abstract getPrimaryCoinPrice: () => Promise<number>;
    abstract getAccountPositionInfos: (accountAddr: AddressType, pools?: PoolInfo[], ids?: AddressType[]) => Promise<PositionInfo[]>;
    abstract getAccountDomain: (accountAddr: AddressType) => Promise<string | null>;

    abstract getGasFeePrice: () => Promise<bigint>;
    abstract getEstimateGasAmount: (t: TransactionOperation.AnyType) => bigint;

    abstract getFeatures: () => Array<ClientFeatures>

    getCoins: () => Promise<CoinType[]> = async () => {
        return (await this.getCoinsAndPools()).coins;
    }

    getPools: () => Promise<PoolInfo[]> = async () => {
        return (await this.getCoinsAndPools()).pools;
    }

    getSortedAccountCoinsArray = async (accountAddr: AddressType, filter: Array<string>) => {
        const coins = await this.getAccountCoins(accountAddr, filter);
        coins.sort((a, b) => (a.balance < b.balance) ? 1 : (a.balance > b.balance ? -1 : 0));
        return filter.map(ty => coins.filter(coin => coin.type.name === ty));
    }
}