import {
    JsonRpcProvider,
    Connection, getObjectFields,
    normalizeSuiObjectId as nid, normalizeSuiAddress as naddr,
    getObjectId, getMoveObjectType, SuiObjectDataFilter,
    PaginatedObjectsResponse, SuiObjectResponse, SuiObjectDataOptions,
    getObjectType, PaginatedCoins, PaginatedEvents, TransactionBlock, CoinStruct, Inputs
} from '@mysten/sui.js';
import { DynamicFieldPage, DynamicFieldInfo } from '@mysten/sui.js/dist/types/dynamic_fields';
import {
    SwapTransactionData, DepositTransactionData, WithdrawTransactionData, PoolInfo, CoinType, PoolType, CoinInfo,
    AddressType, TxHashType, CommonTransaction, uniqArrayOn, PoolBoostMultiplierData,
    ValuePerToken, EndPointType, PositionInfo
} from './common';
import { MoveType } from './move-type';
import { TransactionOperation, TransacationArgument, TransactionArgumentHelper, TransactionTypeSerializeContext } from './transaction';
import { BigIntConstants, NumberLimit, SuiConstants } from './constants';
import { Client, ClientFeatures } from './client';
import { parseMoveStructTag, getTypeTagFullname } from './type-tag';

export interface SuiswapClientTransactionContext {
    accountAddr: AddressType;
}

export type SuiswapClientObjectFilterType = "coin" | "package-related" | "packge-position";

type GetGasCoinType = {
    kind: "address",
    addr: AddressType
} | {
    kind: "coins",
    conis: CoinInfo[]
};

export interface SuiswapClientConstructorProps {
    packageAddr: AddressType;
    swapCapId: AddressType;
    tokenCapId: AddressType;
    tokenBankId: AddressType;
    poolRegistryId: AddressType;
    testTokenSupplyId: AddressType;
    owner: AddressType;
    endpoint: string;
};

export interface SuiswapMoveCallTransaction {
    package: string;
    module: string;
    function: string;
    typeArguments: string[],
    arguments: any[];
    gasPayment: CoinInfo;
}

// const serVecAddr = (v: string[]) => {
//     return Inputs.Pure(v, 'vector<address>');
// }

const serAddr = (v: string) => {
    return Inputs.Pure(v, 'address');
}

const ser64 = (v: bigint | number) => {
    return Inputs.Pure(v, 'u64');
}

const ser8 = (v: number | bigint) => {
    return Inputs.Pure(v, 'u8');
}

const ser128 = (v: number | bigint) => {
    return Inputs.Pure(v, 'u128');
}

const ser256 = (v: number | bigint) => {
    return Inputs.Pure(v, 'u256');
}

// const serVec64 = (v: (bigint[] | number[])) => {
//     return Inputs.Pure(v, 'vector<u64>');
// }

const serString = (v: string) => {
    return Inputs.Pure(v, 'string');
}

export class SuiswapClient extends Client {
    static DEFAULT_GAS_BUDGET = BigInt(3000);

    static DEFAULT_SWAP_GAS_AMOUNT = BigInt(3000);
    static DEFAULT_ADD_LIQUIDITY_GAS_AMOUNT = BigInt(3000);
    static DEFAULT_MINT_TEST_COIN_GAS_AMOUNT = BigInt(3000);
    static DEFAULT_REMOVE_LIQUIDITY_GAS_AMOUNT = BigInt(3000);
    static DEFAULT_SUI_OBJECT_OPTIONS: SuiObjectDataOptions = { showOwner: true, showContent: true, showType: true, showDisplay: true };

    packageAddr: AddressType;
    swapCapId: AddressType;
    tokenCapId: AddressType;
    tokenBankId: AddressType;
    poolRegistryId: AddressType;
    testTokenSupplyId: AddressType;
    owner: AddressType;
    endpoint: string;
    gasFeePrice: bigint;
    provider: JsonRpcProvider;
    cachePoolRefs: Array<{ poolType: PoolType, poolId: AddressType }> | null = null;

    constructor(props: SuiswapClientConstructorProps) {
        super();

        this.packageAddr = nid(props.packageAddr);
        this.swapCapId = nid(props.swapCapId);
        this.tokenCapId = nid(props.tokenCapId);
        this.tokenBankId = nid(props.tokenBankId);
        this.poolRegistryId = nid(props.poolRegistryId);
        this.testTokenSupplyId = nid(props.testTokenSupplyId);

        this.owner = naddr(props.owner);
        this.endpoint = props.endpoint;

        const connection = new Connection({ fullnode: props.endpoint });
        this.provider = new JsonRpcProvider(connection);

        // Initialize as one (before version 0.22)
        this.gasFeePrice = BigIntConstants.ONE;
    }

    getOwnedObjects = async (accountAddr: AddressType, extra?: { filter?: SuiObjectDataFilter, options?: SuiObjectDataOptions }) => {
        const results: PaginatedObjectsResponse[] = [];

        let cursor: PaginatedObjectsResponse['nextCursor'] | undefined = undefined;
        while (true) {

            const r: PaginatedObjectsResponse = await this.provider.getOwnedObjects({
                owner: accountAddr,
                cursor: cursor,
                filter: extra?.filter,
                options: extra?.options ?? SuiswapClient.DEFAULT_SUI_OBJECT_OPTIONS
            });

            results.push(r);
            cursor = r.nextCursor;
            if (!r.hasNextPage) {
                break;
            }
        }

        const objects = results.flatMap(x => x.data) as (SuiObjectResponse[]);
        return objects;
    }

    getObject = async (objectId: AddressType, options?: SuiObjectDataOptions) => {
        return (await this.provider.getObject({ id: objectId, options: options ?? SuiswapClient.DEFAULT_SUI_OBJECT_OPTIONS }));
    }

    getObjects = async (objectIds: AddressType[], options?: SuiObjectDataOptions) => {
        const objects = await this.provider.multiGetObjects({ ids: objectIds, options: options ?? SuiswapClient.DEFAULT_SUI_OBJECT_OPTIONS });
        return objects;
    }

    getDynamicFields = async (objectId: string) => {
        let cursor: string | null = null;
        const pages: DynamicFieldPage[] = [];

        while (true) {
            const page: DynamicFieldPage = await this.provider.getDynamicFields({ parentId: objectId, cursor: cursor });
            pages.push(page);
            cursor = page.nextCursor;
            if (!page.hasNextPage) {
                break;
            }
        }

        const infos = (pages.flatMap(page => page.data) as DynamicFieldInfo[]);
        return infos;
    }

    getCoins_ = async (accountAddr: AddressType) => {
        const results: PaginatedCoins[] = [];

        let cursor: string | null = null;
        while (true) {
            const r: PaginatedCoins = await this.provider.getAllCoins({ owner: accountAddr, cursor: cursor });
            results.push(r);
            cursor = r.nextCursor;
            if (!r.hasNextPage) {
                break;
            }
        }

        const coins = results.flatMap(x => x.data);
        return coins;
    }

    getAccountDomain = async (accountAddr: string) => {
        // A naive implementation
        const objects = await this.getOwnedObjects(accountAddr, { options: { showContent: true, showType: true } });
        const objectDomains = objects.filter(x => (getObjectType(x)?.endsWith("base_registrar::RegistrationNFT") ?? false));

        for (const obj of objectDomains) {
            const f = getObjectFields(obj) as any;
            if (f.name !== undefined) {
                return f.name.toString();
            }
        }

        return null;
    }

    getAccountRelatedObjects = async (accountAddr: string, filter?: SuiswapClientObjectFilterType[]) => {
        const objectsAll = await this.getOwnedObjects(accountAddr);

        if (filter !== undefined && filter!.length > 0) {
            const shouldGetCoin = (filter.find(x => (x === "coin")) !== undefined);
            const shouldGetPackageRelated = (filter.find(x => (x === "package-related")) !== undefined);
            const shouldGetPackagePosition = (filter.find(x => (x === "packge-position")) !== undefined);

            const objects = objectsAll.filter(object => {
                const type_ = getObjectType(object);
                if (type_ === undefined) {
                    return false;
                }

                const typeSplits = type_.split("::");
                const isTypePackgeRelated = nid(typeSplits[0]) == this.packageAddr;
                const isTypeCoin = type_.startsWith("0x2::coin::Coin");

                if (shouldGetCoin && isTypeCoin) {
                    return true;
                }
                if (shouldGetPackageRelated && isTypePackgeRelated) {
                    return true;
                }
                if (shouldGetPackagePosition && isTypePackgeRelated && typeSplits[1] === "pool" && typeSplits[2].startsWith("PoolLsp")) {
                    return true;
                }

                return false;
            });

            return objects;
        }

        return objectsAll;
    }

    getFeatures = () => {
        return [
            ClientFeatures.SupportMultiCoins,
            ClientFeatures.SeparateGasCoin
        ]
    }

    getPackageAddress = () => {
        return this.packageAddr;
    }

    getPrimaryCoinType = () => {
        return SuiConstants.SUI_COIN_TYPE;
    }

    getPool = async (poolInfo: PoolInfo) => {
        const response = (await this.getObject(poolInfo.addr));
        return this.mapResponseToPoolInfo(response)!;
    }

    getPosition = async (positionInfo: PositionInfo, pools: PoolInfo[]) => {
        const response = (await this.getObject(positionInfo.addr));
        return this.mapResponseToPositionInfo(response, pools)!;
    }

    getSuiProvider = () => {
        return this.provider;
    }

    getEstimateGasAmount = (t: TransactionOperation.AnyType) => {
        if (t === "swap") {
            return SuiswapClient.DEFAULT_SWAP_GAS_AMOUNT;
        }
        else if (t === "add-liquidity") {
            return SuiswapClient.DEFAULT_ADD_LIQUIDITY_GAS_AMOUNT;
        }
        else if (t === "remove-liquidity") {
            return SuiswapClient.DEFAULT_REMOVE_LIQUIDITY_GAS_AMOUNT;
        }
        else if (t === "raw") {
            return SuiswapClient.DEFAULT_GAS_BUDGET;
        }
        return SuiswapClient.DEFAULT_GAS_BUDGET;
    }

    getGasFeePrice: () => Promise<bigint> = async () => {
        const provider = this.getSuiProvider();
        try {
            const newGasPrice = await provider.getReferenceGasPrice();
            this.gasFeePrice = BigInt(newGasPrice);
        }
        catch (_e) {

        }
        return this.gasFeePrice;
    }

    getCoinsAndPools: (() => Promise<{ coins: CoinType[]; pools: PoolInfo[]; }>) = async () => {
        // Get all the pool created info
        await this.refreshCachePoolRef(false);

        const pooldIds = await this.getObjects(this.cachePoolRefs!.map(x => x.poolId));
        const poolInfos = pooldIds
            .map((response) => this.mapResponseToPoolInfo(response))
            .filter(x => x !== null) as PoolInfo[];

        const coinAllTypes = poolInfos.flatMap((poolInfo) => [poolInfo.type.xTokenType, poolInfo.type.yTokenType]);
        const coinTypes = uniqArrayOn(coinAllTypes, coinType => coinType.str());

        return { coins: coinTypes, pools: poolInfos };
    };

    getAccountCoins: (accountAddr: AddressType, filters?: Array<CoinType>) => Promise<CoinInfo[]> = async (accountAddr: AddressType, filters?: Array<CoinType>) => {
        let coinObjects = (await this.getCoins_(accountAddr));

        let coins = coinObjects.map(x => {
            let coin = {
                type: MoveType.fromString(x.coinType)!,
                addr: nid(x.coinObjectId),
                balance: BigInt(x.balance),
                raw: x
            } as CoinInfo;
            return coin;
        });

        coins = coins.filter((coin) => coin.balance > BigIntConstants.ZERO);
        if (filters !== undefined) {
            coins = coins.filter((coin) => filters.find(filter => MoveType.equals(filter, coin.type)));
        }
        return coins;
    }

    getAccountPositionInfos = async (accountAddr: string, pools_?: PoolInfo[], ids?: string[] | undefined) => {
        const pools = pools_ ?? (await this.getPools());
        const objects = (ids === undefined)
            ? (await this.getAccountRelatedObjects(accountAddr, ["packge-position"]))
            : (await this.getObjects(ids));

        const positions = objects
            .map(x => this.mapResponseToPositionInfo(x, pools))
            .filter(x => x !== null);
        return (positions as PositionInfo[]);
    }

    getExplorerHrefForTxHash = (txHash: TxHashType, endPointType?: EndPointType) => {
        let suffix = "";
        if (endPointType !== undefined) {
            if (endPointType === "mainnet") {
                suffix = "network=devnet";
            }
            else if (endPointType === "testnet") {
                suffix = "network=testnet";
            }
            else if (endPointType === "devnet") {
                suffix = "network=devnet";
            }
        }
        return `https://explorer.sui.io/transactions/${txHash}` + suffix;
    }

    getTransactions = async (accountAddr: string, limit: number, pools_?: PoolInfo[]) => {
        const pools = pools_ ?? (await this.getPools());

        const swapTxs: CommonTransaction[] = [];
        const depositTxs: CommonTransaction[] = [];
        const withdrawTxs: CommonTransaction[] = [];

        let cursor: PaginatedEvents['nextCursor'] = null;
        while (swapTxs.length + depositTxs.length + withdrawTxs.length < limit) {
            const ev: PaginatedEvents = await this.provider.queryEvents({ query: { Sender: accountAddr }, cursor: cursor, limit: 200, order: 'descending' });
            const events = ev.data;

            events.forEach((event) => {
                const timestamp: number = Number(event.timestampMs);
                const eventId: string = event.id.txDigest;
                const eventName: string = event.type;

                if ((nid(eventName.split("::")[0]) !== this.packageAddr)) {
                    return
                }

                const f = event.parsedJson;

                if (f !== undefined) {
                    // Swap event
                    if (eventName.endsWith("::pool::SwapTokenEvent")) {
                        const n_poolId = f.pool_id;
                        const n_xToY = f.x_to_y;
                        const n_inAmount = f.in_amount;
                        const n_outAmount = f.out_amount;

                        if (n_poolId !== undefined && n_xToY !== undefined && n_inAmount !== undefined && n_outAmount !== undefined) {
                            const poolId = nid(f.pool_id);
                            const poolInfo = pools.find(x => x.addr === poolId);
                            const xToY = Boolean(f.x_to_y);
                            const inAmount = BigInt(f.in_amount);
                            const outAmount = BigInt(f.out_amount);
                            if (poolInfo) {
                                const data: SwapTransactionData = {
                                    poolType: poolInfo.type,
                                    direction: xToY ? "forward" : "reverse",
                                    inAmount: inAmount,
                                    outAmount: outAmount
                                };
                                swapTxs.push({
                                    id: eventId,
                                    href: this.getExplorerHrefForTxHash(eventId),
                                    type: "swap",
                                    success: true,
                                    data: data,
                                    timestamp: timestamp / 1000.0
                                })
                            }
                        }
                    }
                    // Liquidity event
                    if (eventName.endsWith("::pool::LiquidityEvent")) {
                        const n_pool_id = f.pool_id;
                        const n_is_added = f.is_added;
                        const n_x_amount = f.x_amount;
                        const n_y_amount = f.y_amount;
                        const n_lsp_amount = f.lsp_amount;
                        if (n_pool_id !== undefined && n_is_added !== undefined && n_x_amount !== undefined && n_y_amount !== undefined && n_lsp_amount !== undefined) {
                            const poolId = nid(f.pool_id);
                            const poolInfo = pools.find(x => x.addr === poolId);
                            const p_is_added = Boolean(n_is_added);
                            const p_x_amount = BigInt(n_x_amount);
                            const p_y_amount = BigInt(n_y_amount);
                            if (poolInfo) {
                                if (p_is_added) {
                                    const data: DepositTransactionData = {
                                        poolType: poolInfo.type,
                                        inAmountX: p_x_amount,
                                        inAmountY: p_y_amount
                                    };
                                    depositTxs.push({
                                        id: eventId,
                                        href: this.getExplorerHrefForTxHash(eventId),
                                        type: "deposit",
                                        success: true,
                                        data: data,
                                        timestamp: timestamp / 1000.0
                                    });
                                }
                                else {
                                    const data: WithdrawTransactionData = {
                                        poolType: poolInfo.type,
                                        outAmountX: p_x_amount,
                                        outAmountY: p_y_amount
                                    };
                                    withdrawTxs.push({
                                        id: eventId,
                                        href: this.getExplorerHrefForTxHash(eventId),
                                        type: "withdraw",
                                        success: true,
                                        data: data,
                                        timestamp: timestamp / 1000.0
                                    })
                                }
                            }
                        }
                    }
                }
            });

            if (ev.hasNextPage === false || events.length === 0 || ev.nextCursor === null) {
                break;
            }
            cursor = ev.nextCursor;
        }

        return [...swapTxs, ...depositTxs, ...withdrawTxs].sort((a, b) => b.timestamp - a.timestamp);
    }

    getPrimaryCoinPrice: () => Promise<number> = async () => {
        return (38.535 + Math.random() * 0.03);
    }

    generateMoveTransaction = async (opt: TransactionOperation.Any, ctx: SuiswapClientTransactionContext) => {
        if (opt.operation === "swap") {
            return (await this._generateMoveTransaction_Swap(opt as TransactionOperation.Swap, ctx));
        }
        else if (opt.operation === "add-liquidity") {
            return (await this._generateMoveTransaction_AddLiquidity(opt as TransactionOperation.AddLiquidity, ctx));
        }
        else if (opt.operation === "remove-liquidity") {
            return (await this._generateMoveTransaction_RemoveLiquidity(opt as TransactionOperation.RemoveLiquidity, ctx));
        }
        else if (opt.operation === "raw") {
            return (await this._generateMoveTransaction_Raw(opt as TransactionOperation.Raw, ctx));
        }
        throw new Error(`generateMoveTransaction not implemented for certain operation`);
    }

    generateMoveTransactionOrNull = async (opt: TransactionOperation.Any, ctx: SuiswapClientTransactionContext) => {
        try {
            const transaction = await this.generateMoveTransaction(opt, ctx);
            return transaction;
        } catch (e) {
            return null;
        }
    }

    getGasCoin = async (param: GetGasCoinType, excludeCoinsAddresses: AddressType[], estimateGas: bigint) => {
        const primaryCoins = (param.kind === "address")
            ? (await this.getAccountCoins(param.addr, [this.getPrimaryCoinType()]))
            : param.conis.filter(coin => MoveType.equals(coin.type, this.getPrimaryCoinType()));
        ;
        const primaryCoinsFiltered = primaryCoins.filter(coin => excludeCoinsAddresses.indexOf(coin.addr) === -1);

        let minimumGasCoinIndex = -1;
        primaryCoinsFiltered.forEach((coin, index) => {
            if (coin.balance >= estimateGas) {
                if (minimumGasCoinIndex < 0 || primaryCoinsFiltered[minimumGasCoinIndex].balance > coin.balance) {
                    minimumGasCoinIndex = index;
                }
            }
        })

        if (minimumGasCoinIndex < 0) {
            return null;
        }

        return primaryCoinsFiltered[minimumGasCoinIndex];
    }

    isPoolInfoObject = (response: SuiObjectResponse) => {
        const type_ = getMoveObjectType(response);
        if (!type_) { return false; }

        const ts = type_.split("::");
        const valid = nid(ts[0]) == this.packageAddr && ts[1] === "pool" && ts[2].startsWith("Pool<")
        return valid;
    }

    isPositionInfoObject = (response: SuiObjectResponse) => {
        const type_ = getMoveObjectType(response);
        if (!type_) { return false; }

        const ts = type_.split("::");
        const valid = nid(ts[0]) == this.packageAddr && ts[1] === "pool" && ts[2].startsWith("PoolLsp<")
        return valid;
    }

    mapResponseToPoolInfo = (response: SuiObjectResponse) => {
        if (!this.isPoolInfoObject(response)) {
            return null;
        }

        const EPoolTypeV2 = 100;
        // const EPoolTypeStableSwap = 101;
        const EFeeDirectionX = 200;
        // const EFeeDirectionY = 201;
        const ETokenHolderRewardTypeBalance = 210;
        // const ETokenHolderRewardTypeAutoBackBuy = 211;

        try {
            const typeString = getMoveObjectType(response);
            if (typeString === undefined) {
                return null;
            }

            const poolTemplateType = parseMoveStructTag(typeString);
            const poolType: PoolType = new PoolType({
                xTokenType: MoveType.fromString(getTypeTagFullname(poolTemplateType.typeParams[0]))!,
                yTokenType: MoveType.fromString(getTypeTagFullname(poolTemplateType.typeParams[1]))!,
            });
            const fields = getObjectFields(response);
            if (fields === undefined) {
                return null;
            }

            const poolInfo = new PoolInfo({
                addr: nid(fields.id.id),
                typeString: typeString,
                index: Number(fields.index),
                type: poolType,
                swapType: Number(fields.pool_type) === EPoolTypeV2 ? "v2" : "stable",
                lspSupply: BigInt(fields.lsp_supply),
                freeze: fields.freeze,
                boostMultiplierData: fields.boost_multiplier_data?.map(
                    (x: any) => ({ epoch: Number(x.fields.epoch), boostMultiplier: BigInt(x.fields.boost_multiplier) } as PoolBoostMultiplierData)
                ),
                feeDirection: (Number(fields.fee.fields.direction) === EFeeDirectionX) ? "X" : "Y",
                adminFee: BigInt(fields.fee.fields.admin),
                lpFee: BigInt(fields.fee.fields.lp),
                thFee: BigInt(fields.fee.fields.th),
                withdrawFee: BigInt(fields.fee.fields.withdraw),
                x: BigInt(fields.balance.fields.x),
                y: BigInt(fields.balance.fields.y),
                xAdmin: BigInt(fields.balance.fields.x_admin),
                yAdmin: BigInt(fields.balance.fields.y_admin),
                xTh: BigInt(fields.balance.fields.x_th),
                yTh: BigInt(fields.balance.fields.y_th),
                stableAmp: BigInt(fields.stable.fields.amp),
                stableXScale: BigInt(fields.stable.fields.x_scale),
                stableYScale: BigInt(fields.stable.fields.y_scale),
                totalTradeX: BigInt(fields.total_trade.fields.x),
                totalTradeY: BigInt(fields.total_trade.fields.y),
                totalTradeXLastEpoch: BigInt(fields.total_trade.fields.x_last_epoch),
                totalTradeYLastEpoch: BigInt(fields.total_trade.fields.y_last_epoch),
                totalTradeXCurrentEpoch: BigInt(fields.total_trade.fields.x_current_epoch),
                totalTradeYCurrentEpoch: BigInt(fields.total_trade.fields.y_current_epoch),

                thRewardType: Number(fields.th_reward.fields.type) == ETokenHolderRewardTypeBalance ? "Balance" : "AutoBuyBack",
                thRewardEndEpoch: BigInt(fields.th_reward.fields.end_epoch),
                thRewardNepoch: BigInt(fields.th_reward.fields.nepoch),
                thRewardStartEpcoh: BigInt(fields.th_reward.fields.start_epcoh),
                thRewardTotalStakeAmount: BigInt(fields.th_reward.fields.total_stake_amount),
                thRewardTotalStakeBoost: BigInt(fields.th_reward.fields.total_stake_boost),
                thRewardX: BigInt(fields.th_reward.fields.x),
                thRewardXSupply: BigInt(fields.th_reward.fields.x_supply),
                thRewardY: BigInt(fields.th_reward.fields.y),
                thRewardYSupply: BigInt(fields.th_reward.fields.y_supply),

                miningSpeed: BigInt(fields.mining.fields.speed),
                miningAmpt: new ValuePerToken(
                    BigInt(fields.mining.fields.ampt.fields.sum),
                    BigInt(fields.mining.fields.ampt.fields.amount),
                ),
                miningLastEpoch: BigInt(fields.mining.fields.last_epoch),
            });

            return poolInfo;
        } catch (_e) {
            return null;
        }
    }

    mapResponseToPositionInfo = (response: SuiObjectResponse, pools: PoolInfo[]) => {
        if (!this.isPositionInfoObject(response)) {
            return null;
        }

        const type_ = getMoveObjectType(response)!;
        const typeTag = parseMoveStructTag(type_);

        // Check validation
        if (!(nid(typeTag.address) === this.packageAddr && typeTag.module === "pool" && typeTag.name === "PoolLsp")) {
            return null;
        }

        // Get the pool infos
        const f = getObjectFields(response)!;
        const addr = getObjectId(response)!;
        const poolId = f.pool_id;

        // Try to find the pool id
        const poolInfo = pools.find(x => nid(x.addr) == nid(poolId));
        if (!poolInfo) {
            return null;
        }

        const value = BigInt(f.value);
        const poolX = BigInt(f.pool_x);
        const poolY = BigInt(f.pool_y);
        const startEpoch = BigInt(f.start_epoch);
        const endEpoch = BigInt(f.end_epoch);
        const boostMultiplier = BigInt(f.boost_multiplier);
        const poolMiningAmpt = new ValuePerToken(
            BigInt(f.pool_mining_ampt.fields.sum),
            BigInt(f.pool_mining_ampt.fields.amount),
        );

        return new PositionInfo({ addr, poolInfo, value, poolX, poolY, poolMiningAmpt, startEpoch, endEpoch, boostMultiplier });
    }

    mapResponseToCoinInfo = (response: SuiObjectResponse) => {
        const f = getObjectFields(response);
        const type_ = getObjectType(response);
        if (f === undefined || type_ === undefined || !type_.startsWith("0x2::coin::Coin<")) {
            return null;
        }

        try {
            const coin = {
                type: MoveType.fromString(type_.trim().replace(/^0x2::coin::Coin<(.+)>$/, "$1")),
                addr: f.id.id as AddressType,
                balance: BigInt(f.balance)
            } as CoinInfo;
            return coin;                
        } catch {
            return null;
        }
    }

    mapMoveCallTransactionToTransactionBlock = (tr: SuiswapMoveCallTransaction) => {
        const gasCoinRaw: CoinStruct = tr.gasPayment.raw!;

        const tx = new TransactionBlock();
        tx.setGasPayment([{ objectId: gasCoinRaw.coinObjectId, version: gasCoinRaw.version, digest: gasCoinRaw.digest }]);
        tx.moveCall({
            target: `${nid(tr.package)}::${tr.module}::${tr.function}`,
            typeArguments: tr.typeArguments,
            arguments: tr.arguments.map(x => tx.pure(x))
        });

        return tx;
    }

    refreshCachePoolRef = async (force: boolean) => {
        if (force == true || this.cachePoolRefs === null) {
            const cachePoolRefs: Array<{ poolType: PoolType, poolId: AddressType }> = [];

            const poolDfInfos = await this.getDynamicFields(this.poolRegistryId);
            const poolDfIds = poolDfInfos.map(x => x.objectId);
            const poolDfs = await this.getObjects(poolDfIds);

            poolDfs.forEach(poolDf => {
                const f = getObjectFields(poolDf)!;
                const keyType = parseMoveStructTag((f.name?.type) as string);

                const type0 = getTypeTagFullname(keyType.typeParams[0]);
                const type1 = getTypeTagFullname(keyType.typeParams[1]);

                const poolId: string = f.value?.fields.pool_id;
                const reverse: boolean = f.value?.fields.reverse;

                const poolXType: string = (reverse ? type1 : type0);
                const poolYType: string = (reverse ? type0 : type1);

                const poolType: PoolType = new PoolType({
                    xTokenType: MoveType.fromString(poolXType)!,
                    yTokenType: MoveType.fromString(poolYType)!,
                });
                cachePoolRefs.push({ poolType, poolId });
            });

            this.cachePoolRefs = uniqArrayOn(cachePoolRefs, x => x.poolId);
        }
    }

    _getCoinsLargerThanBalance = (cs: CoinInfo[], targetBalance: bigint) => {
        const cs1 = [...cs];
        cs1.sort((a, b) => (a.balance < b.balance) ? -1 : (a.balance > b.balance ? 1 : 0));

        const cs2: Array<CoinInfo> = [];
        let balance = BigIntConstants.ZERO;
        for (const coin of cs1) {
            if (balance >= targetBalance) {
                break;
            }
            cs2.push(coin);
            balance += coin.balance;
        }

        return [cs2, balance] as [CoinInfo[], bigint]
    }

    _generateMoveTransaction_Swap = async (opt: TransactionOperation.Swap, ctx: SuiswapClientTransactionContext) => {
        if (opt.amount <= 0 || opt.amount > NumberLimit.U64_MAX) {
            throw new Error(`Invalid input amount for swapping: ${opt.amount}`);
        }

        if ((opt.minOutputAmount !== undefined) && (opt.minOutputAmount < BigIntConstants.ZERO || opt.minOutputAmount > NumberLimit.U64_MAX)) {
            throw new Error(`Invalid min output amount for swapping: ${opt.minOutputAmount}`);
        }

        if (opt.pool.freeze) {
            throw new Error(`Cannot not swap for freeze pool: ${opt.pool.addr}`);
        }

        const swapCoinType = (opt.direction === "forward") ? opt.pool.type.xTokenType : opt.pool.type.yTokenType;
        const swapCoins = await this.getAccountCoins(ctx.accountAddr, [swapCoinType]);
        const swapCoinsTotalBalance = swapCoins.reduce((sum, coin) => (sum + coin.balance), BigIntConstants.ZERO);

        if (swapCoinsTotalBalance < opt.amount) {
            throw new Error(`Not enough balance for swapping, max amount: ${swapCoinsTotalBalance}, target amount: ${opt.amount}`);
        }

        const pacakge_ = this.getPackageAddress();
        const module_ = "pool";
        const function_ = (opt.direction == "forward") ? "swap_x_to_y" : "swap_y_to_x";

        // Check whether its SUI coin
        const isSui = MoveType.equals(swapCoinType, this.getPrimaryCoinType())

        const tx = new TransactionBlock();

        // Special handling if sui coin is used for input transaction
        if (isSui) {
            tx.setGasPayment(swapCoins.map(c => {
                const cs: CoinStruct = c.raw!;
                return { version: cs.version, digest: cs.digest, objectId: cs.coinObjectId }
            }));
            const [inCoin] = tx.splitCoins(tx.gas, [tx.pure(opt.amount)]);

            tx.moveCall({
                target: `${pacakge_}::${module_}::${function_}`,
                typeArguments: [opt.pool.type.xTokenType.str(), opt.pool.type.yTokenType.str()],
                arguments: [
                    tx.object(opt.pool.addr),
                    tx.makeMoveVec({ objects: [inCoin] }),
                    tx.pure(ser64(opt.amount)),
                    tx.pure(ser64(opt.minOutputAmount ?? 0))
                ]
            })
        }
        else {
            tx.moveCall({
                target: `${pacakge_}::${module_}::${function_}`,
                typeArguments: [opt.pool.type.xTokenType.str(), opt.pool.type.yTokenType.str()],
                arguments: [
                    tx.object(opt.pool.addr),
                    tx.makeMoveVec({ objects: swapCoins.map(x => tx.object(x.addr)) }),
                    tx.pure(ser64(opt.amount)),
                    tx.pure(ser64(opt.minOutputAmount ?? 0))
                ]
            })
        }

        return tx;
    }

    _generateMoveTransaction_AddLiquidity = async (opt: TransactionOperation.AddLiquidity, ctx: SuiswapClientTransactionContext) => {
        const pool = opt.pool;
        const xAmount = opt.xAmount;
        const yAmount = opt.yAmount;

        if (((xAmount <= 0 || xAmount > NumberLimit.U64_MAX) || (yAmount <= 0 || yAmount > NumberLimit.U64_MAX))) {
            throw new Error(`Invalid input amount for adding liquidity: ${xAmount} or minOutputAmount: ${yAmount}`);
        }

        if (pool.freeze) {
            throw new Error(`Cannot not swap for freeze pool: ${pool.addr}`);
        }

        const accountAddr = ctx.accountAddr;
        const coins = await this.getAccountCoins(accountAddr, [pool.type.xTokenType, pool.type.yTokenType]);

        if (accountAddr === null) {
            throw new Error("Cannot get the current account address from wallet")
        }

        // Getting the both x coin and y coin
        const swapXCoins = coins.filter(c => MoveType.equals(c.type, pool.type.xTokenType));
        const swapYCoins = coins.filter(c => MoveType.equals(c.type, pool.type.yTokenType));

        if (swapXCoins.length === 0) {
            throw new Error(`The account doesn't hold the coin for adding liquidity: ${pool.type.xTokenType.str()}`);
        }
        if (swapYCoins.length === 0) {
            throw new Error(`The account doesn't hold the coin for adding liquidity: ${pool.type.yTokenType.str()}`);
        }

        const swapXCoinsTotalAmount = swapXCoins.reduce((sum, coin) => sum + coin.balance, BigIntConstants.ZERO);
        const swapYCoinsTotalAmount = swapYCoins.reduce((sum, coin) => sum + coin.balance, BigIntConstants.ZERO);

        if (swapXCoinsTotalAmount < xAmount) {
            throw new Error(`The account has insuffcient balance for coin ${pool.type.xTokenType.str()}, current balance: ${swapXCoinsTotalAmount}, expected: ${xAmount}`);
        }
        if (swapYCoinsTotalAmount < yAmount) {
            throw new Error(`The account has insuffcient balance for coin ${pool.type.yTokenType.str()}, current balance: ${swapYCoinsTotalAmount}, expected: ${yAmount}`);
        }

        const isXSui = MoveType.equals(pool.type.xTokenType, this.getPrimaryCoinType());
        const isYSui = MoveType.equals(pool.type.yTokenType, this.getPrimaryCoinType());

        const tx = new TransactionBlock();
        // let txXCoins: any = tx.makeMoveVec({ objects: swapXCoins.map(c => tx.object(c.addr)) });
        // let txYCoins: any = tx.makeMoveVec({ objects: swapYCoins.map(c => tx.object(c.addr)) });

        // Special case when X is sui
        if (isXSui) {
            tx.setGasPayment(swapXCoins.map(c => {
                const cs: CoinStruct = c.raw!;
                return { version: cs.version, digest: cs.digest, objectId: cs.coinObjectId }
            }));
            const [cSplit] = tx.splitCoins(tx.gas, [tx.pure(ser64(xAmount))]);

            tx.moveCall({
                target: `${this.getPackageAddress()}::pool::add_liquidity`,
                typeArguments: [pool.type.xTokenType.str(), pool.type.yTokenType.str()],
                arguments: [
                    tx.object(pool.addr),
                    tx.makeMoveVec({ objects: [ cSplit ]}),
                    tx.makeMoveVec({ objects: swapYCoins.map(c => tx.object(c.addr))}),
                    tx.pure(ser64(xAmount)),
                    tx.pure(ser64(yAmount)),
                    tx.pure(ser64(opt.unlockEpoch))
                ],
            });
        }
        // Special case when Y is sui
        else if (isYSui) {
            tx.setGasPayment(swapYCoins.map(c => {
                const cs: CoinStruct = c.raw!;
                return { version: cs.version, digest: cs.digest, objectId: cs.coinObjectId }
            }));
            const [cSplit] = tx.splitCoins(tx.gas, [tx.pure(ser64(yAmount))]);

            tx.moveCall({
                target: `${this.getPackageAddress()}::pool::add_liquidity`,
                typeArguments: [pool.type.xTokenType.str(), pool.type.yTokenType.str()],
                arguments: [
                    tx.object(pool.addr),
                    tx.makeMoveVec({ objects: swapXCoins.map(c => tx.object(c.addr))}),
                    tx.makeMoveVec({ objects: [ cSplit ]}),
                    tx.pure(ser64(xAmount)),
                    tx.pure(ser64(yAmount)),
                    tx.pure(ser64(opt.unlockEpoch))
                ],
            });
        }
        else {
            tx.moveCall({
                target: `${this.getPackageAddress()}::pool::add_liquidity`,
                typeArguments: [pool.type.xTokenType.str(), pool.type.yTokenType.str()],
                arguments: [
                    tx.object(pool.addr),
                    tx.makeMoveVec({ objects: swapXCoins.map(c => tx.object(c.addr))}),
                    tx.makeMoveVec({ objects: swapYCoins.map(c => tx.object(c.addr))}),
                    tx.pure(ser64(xAmount)),
                    tx.pure(ser64(yAmount)),
                    tx.pure(ser64(opt.unlockEpoch))
                ],
            });
        }

        return tx;
    }

    _generateMoveTransaction_RemoveLiquidity = async (opt: TransactionOperation.RemoveLiquidity, ctx: SuiswapClientTransactionContext) => {
        const position = opt.positionInfo;
        const pool = position.poolInfo;
        const amount = position.balance();

        if ((amount <= 0 || amount > NumberLimit.U64_MAX)) {
            throw new Error(`Invalid input coin, balance is zero`);
        }

        const accountAddr = ctx.accountAddr;
        if (accountAddr === null) {
            throw new Error("Cannot get the current account address from wallet")
        }

        // Getting the both x coin and y coin

        // Entry: entry fun remove_liquidity<X, Y>(pool: &mut Pool<X, Y>, lsp: Coin<LSP<X, Y>>, lsp_amount: u64, ctx: &mut TxContext)
        const tx = new TransactionBlock();
        tx.moveCall({
            target: `${this.packageAddr}::pool::remove_liquidity`,
            typeArguments: [pool.type.xTokenType.str(), pool.type.yTokenType.str()],
            arguments: [
                tx.object(pool.addr),
                tx.object(this.tokenBankId),
                tx.object(position.addr),
                tx.pure(ser64(amount))
            ]
        });

        return tx;
    }

    _generateMoveTransaction_Raw = async (opt: TransactionOperation.Raw, ctx: SuiswapClientTransactionContext) => {
        const accountAddr = ctx.accountAddr;
        const tCtx: TransactionTypeSerializeContext = { packageAddr: this.packageAddr, sender: accountAddr };

        // Construct the transaction block
        const tx = new TransactionBlock();

        // Serialize the transaction
        const t = opt.transaction;
        const sp = t.function.split("::");
        const package_ = nid(sp[0].replace("@", this.packageAddr));
        const module_ = sp[1];
        const function_ = sp[2];
        const typeArguments = t.type_arguments.map(ty => ty.replace("@", this.packageAddr));
        const arguments_: any[] = t.arguments.map((arg: TransacationArgument) => {
            const vs = TransactionArgumentHelper.normalizeTransactionArgument(arg, tCtx);

            const tag = vs[0];
            const value = vs[1];

            if (tag === "object") {
                return tx.object(value.toString())
            }
            else if (tag === "address") {
                return tx.pure(serAddr(value.toString()));
            }
            else if (tag === "string") {
                return tx.pure(serString(value.toString()));
            }
            else if (tag === "u8") {
                return tx.pure(ser8(value as any));
            }
            else if (tag === "u64") {
                return tx.pure(ser64(value as any));
            }
            else if (tag === "u128") {
                return tx.pure(ser128(value as any));
            }
            else if (tag === "u256") {
                return tx.pure(ser256(value as any));
            }

            // Should never ends here
            return null;
        });

        tx.moveCall({
            target: `${package_}::${module_}::${function_}`,
            typeArguments: typeArguments,
            arguments: arguments_
        })

        return tx;
    }
}