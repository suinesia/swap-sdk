import {  PoolInfo, CoinType, CoinInfo, AddressType, TxHashType, PositionInfo, CommonTransaction } from './common';

export abstract class Client {
    abstract getPackageAddress: () => AddressType;
    abstract getCoinsAndPools: () => Promise<{ coins: CoinType[], pools: PoolInfo[] }>;
    abstract getPool: (poolInfo: PoolInfo) => Promise<PoolInfo | null>;

    abstract getAccountCoins: (accountAddr: AddressType, filter?: Array<string>) => Promise<CoinInfo[]>;
    abstract getExplorerHrefForTxHash?: (txHash: TxHashType) => string;
    abstract getPrimaryCoinType: () => CoinType;
    abstract getTransactions: (accountAddr: AddressType, limit: number) => Promise<CommonTransaction[]>;
    abstract getPrimaryCoinPrice: () => Promise<number>;
    abstract getAccountPositionInfos: (pools: PoolInfo[], coins: CoinInfo[]) => PositionInfo[];
    abstract getGasFeePrice: () => Promise<bigint>;

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