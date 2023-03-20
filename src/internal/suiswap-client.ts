import { bcs as SuiBCS, SuiJsonValue, JsonRpcProvider as SuiJsonRpcProvider, MoveCallTransaction as SuiMoveCallTransaction, SuiMoveObject, SuiObject, GetObjectDataResponse, Connection, getObjectFields, normalizeSuiObjectId as nid, normalizeSuiAddress as naddr, getObjectId, getMoveObjectType, EventId, normalizeSuiAddress} from '@mysten/sui.js';
import { SwapTransactionData, DepositTransactionData, WithdrawTransactionData, MoveTemplateType, PoolInfo, CoinType, PoolType, CoinInfo, AddressType, TxHashType, CommonTransaction, uniqArrayOn, isSameCoinType, isSameCoin, PoolBoostMultiplierData, ValuePerToken, EndPointType, PositionInfo } from './common';
import { TransactionOperation, TransacationArgument, TransactionArgumentHelper, TransactionTypeSerializeContext } from './transaction';
import { BigIntConstants, NumberLimit, SuiConstants } from './constants';
import { Client, ClientFeatures } from './client';
import { parseMoveStructTag, getTypeTagFullname } from './type-tag';
import { SuinsClient } from "@suins/toolkit"

export interface SuiswapClientTransactionContext {
    accountAddr: AddressType;
    gasBudget?: bigint;
}

export type SuiswapClientObjectFilterType = "coin" | "package-related" | "packge-position" ;

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

export class SuiswapClient extends Client {
    static DEFAULT_GAS_BUDGET = BigInt(3000);

    static DEFAULT_SWAP_GAS_AMOUNT = BigInt(3000);
    static DEFAULT_ADD_LIQUIDITY_GAS_AMOUNT = BigInt(3000);
    static DEFAULT_MINT_TEST_COIN_GAS_AMOUNT = BigInt(3000);
    static DEFAULT_REMOVE_LIQUIDITY_GAS_AMOUNT = BigInt(3000);
    
    packageAddr: AddressType;
    swapCapId: AddressType;
    tokenCapId: AddressType;
    tokenBankId: AddressType;
    poolRegistryId: AddressType;
    testTokenSupplyId: AddressType;
    owner: AddressType;
    endpoint: string;
    gasFeePrice: bigint;

    provider: SuiJsonRpcProvider;
    suiNSClient: SuinsClient;

    cachePoolRefs: Array<{ poolType: PoolType, poolId: AddressType }> | null = null;

    constructor(props : SuiswapClientConstructorProps) {
        super();

        this.packageAddr = nid(props.packageAddr);
        this.swapCapId = nid(props.swapCapId);
        this.tokenCapId = nid(props.tokenCapId);
        this.tokenBankId = nid(props.tokenBankId);
        this.poolRegistryId = nid(props.poolRegistryId);
        this.testTokenSupplyId = nid(props.testTokenSupplyId);

        this.owner =  naddr(props.owner);
        this.endpoint = props.endpoint;

        const connection = new Connection({ fullnode: props.endpoint });
        this.provider = new SuiJsonRpcProvider(connection);
        this.suiNSClient = new SuinsClient(this.provider);

        // Initialize as one (before version 0.22)
        this.gasFeePrice = BigIntConstants.ONE;
    }

    getAccountDomain = async (accountAddr: string) => {
        const domain = await this.suiNSClient.getName(normalizeSuiAddress(accountAddr));
        if (domain === undefined) {
            return null;
        }
        return domain;
    }

    getAccountRelatedIds = async (accountAddr: string, filter?: SuiswapClientObjectFilterType[]) => {
        const objectAllRefs = await this.provider.getObjectsOwnedByAddress(accountAddr);

        let objectRefs = objectAllRefs;
        if (filter !== undefined && filter!.length > 0) {
            const shouldGetCoin = (filter.find(x => (x === "coin")) !== undefined);
            const shouldGetPackageRelated = (filter.find(x => (x === "package-related")) !== undefined);
            const shouldGetPackagePosition = (filter.find(x => (x === "packge-position")) !== undefined);

            objectRefs = objectAllRefs.filter( objectRef => {
                const type_ = objectRef.type;
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
        }

        return objectRefs.map(x => x.objectId);
    }

    getAccountRelatedObjects = async (accountAddr: string, filter?: SuiswapClientObjectFilterType[]) => {
        const objectIds = await this.getAccountRelatedIds(accountAddr, filter);
        const objects = await this.provider.getObjectBatch(objectIds);
        return objects;
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
        const response = (await this.provider.getObject(poolInfo.addr));
        return this.mapResponseToPoolInfo(response)!;
    }

    getPosition = async (positionInfo: PositionInfo, pools: PoolInfo[]) => {
        const response = (await this.provider.getObject(positionInfo.addr));
        return this.mapResponseToPositionInfo(response, pools)!;
    }

    getSuiProvider = () => {
        return this.provider;
    }

    getEstimateGasAmount = (t: TransactionOperation.AnyType) => {
        if (t === "swap") {
            return SuiswapClient.DEFAULT_SWAP_GAS_AMOUNT;
        }
        else if (t === "add-liqudity") {
            return SuiswapClient.DEFAULT_ADD_LIQUIDITY_GAS_AMOUNT;
        }
        else if (t === "remove-liqudity") {
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
        
        const pooldIds = await this.provider.getObjectBatch(this.cachePoolRefs!.map(x => x.poolId));
        const poolInfos = pooldIds
            .map((response) => this.mapResponseToPoolInfo(response))
            .filter(x => x !== null) as PoolInfo[];

        const coinAllTypes = poolInfos.flatMap((poolInfo) => [poolInfo.type.xTokenType, poolInfo.type.yTokenType]);
        const coinTypes = uniqArrayOn(coinAllTypes, coinType => coinType.name);

        return { coins: coinTypes, pools: poolInfos };
    };

    getAccountCoins: (accountAddr: AddressType, filter?: string[] | undefined) => Promise<CoinInfo[]> = async (accountAddr: AddressType, filter?: Array<string>) => {
        let coinFilter = new Set<string>();
        if (filter !== undefined) {
            filter.forEach((x) => { coinFilter.add(`0x2::coin::Coin<${x}>`) });
        }

        const accountObjects = (await this.provider.getObjectsOwnedByAddress(accountAddr));
        const accountCoinObjects = accountObjects.filter((obj) => obj.type.startsWith("0x2::coin::Coin"));
        const accountFilteredCoinObjects = (filter === undefined) ? accountCoinObjects : accountCoinObjects.filter((obj) => coinFilter.has(obj.type));

        const coinAddrs = accountFilteredCoinObjects.map(x => x.objectId);
        const coinObjects = (await this.provider.getObjectBatch(coinAddrs)).filter(x => (x.status === "Exists"));

        const coins = coinObjects.map(x => {
            let data = ((x.details as SuiObject).data as SuiMoveObject);
            let coin = {
                type: { name: data.type.replace(/^0x2::coin::Coin<(.+)>$/, "$1"), network: "sui" },
                addr: data.fields.id.id as AddressType,
                balance: BigInt(data.fields.balance)
            } as CoinInfo;
            return coin;
        });

        return coins.filter((coin) => coin.balance > BigIntConstants.ZERO);
    }

    getAccountPositionInfos = async (accountAddr: string, pools_?: PoolInfo[], ids?: string[] | undefined) => {
        const pools = pools_ ?? (await this.getPools());

        const objectIds = ids ?? (await this.getAccountRelatedIds(accountAddr, ["package-related"]));
        const objects = await this.provider.getObjectBatch(objectIds);
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
        
        const swapTxs: CommonTransaction[] =[];
        const depositTxs: CommonTransaction[] = [];
        const withdrawTxs: CommonTransaction[] = [];

        let cursor: EventId | null = null;
        while (swapTxs.length + depositTxs.length + withdrawTxs.length < limit) {
            const ev: any = await this.provider.getEvents({ Sender: accountAddr }, cursor, 200);
            const events: any[] = ev.data;

            events.forEach((event) => {
                const timestamp: number = Number(event.timestamp);
                const eventId: string = event.txDigest;
                const eventName: string | null = (event.event as any).moveEvent?.type ?? null;

                if ((eventId === undefined) || (eventName === null) || (nid(eventName.split("::")[0]) !== this.packageAddr)) { 
                    return
                }

                const f = (event.event as any).moveEvent?.fields;

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

            if (events.length === 0 || ev.nextCursor === null || ev.nextCursor === undefined) {
                break;
            }
            cursor = ev.nextCursor!;
        }

        return [...swapTxs, ...depositTxs, ...withdrawTxs];
    }

    getPrimaryCoinPrice: () => Promise<number> = async () => {
        return (38.535 + Math.random() * 0.03);
    }

    generateMoveTransaction = async (opt: TransactionOperation.Any, ctx: SuiswapClientTransactionContext) => {
        if (opt.operation === "swap") {
            return (await this._generateMoveTransaction_Swap(opt as TransactionOperation.Swap, ctx));
        }
        else if (opt.operation === "add-liqudity") {
            return (await this._generateMoveTransaction_AddLiqudity(opt as TransactionOperation.AddLiqudity, ctx));
        }
        else if (opt.operation === "remove-liqudity") {
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

    getGasCoin = async (accountAddr: AddressType, excludeCoinsAddresses: AddressType[], estimateGas: bigint) => {
        const primaryCoins = (await this.getSortedAccountCoinsArray(accountAddr, [this.getPrimaryCoinType().name]))[0];
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

    isCoinInfoObject = (response: GetObjectDataResponse) => {
        return getMoveObjectType(response)?.startsWith("0x2::coin::Coin<") ?? false;
    }

    isPoolInfoObject = (response: GetObjectDataResponse) => {
        const type_ = getMoveObjectType(response);
        if (!type_) { return false; }

        const ts = type_.split("::");
        const valid = nid(ts[0]) == this.packageAddr && ts[1] === "pool" && ts[2].startsWith("Pool<")
        return valid;
    }

    isPositionInfoObject = (response: GetObjectDataResponse) => {
        const type_ = getMoveObjectType(response);
        if (!type_) { return false; }

        const ts = type_.split("::");
        const valid = nid(ts[0]) == this.packageAddr && ts[1] === "pool" && ts[2].startsWith("PoolLsp<")
        return valid;
    }

    mapResponseToPoolInfo = (response: GetObjectDataResponse) => {
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
            const details = response.details as SuiObject;
            const typeString = (details.data as SuiMoveObject).type;
            const poolTemplateType = MoveTemplateType.fromString(typeString)!;
            const poolType: PoolType = {
                xTokenType: { network: "sui", name: poolTemplateType.typeArgs[0] },
                yTokenType: { network: "sui", name: poolTemplateType.typeArgs[1] },
            };
            const fields = (details.data as SuiMoveObject).fields;

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

    mapResponseToPositionInfo = (response: GetObjectDataResponse, pools: PoolInfo[]) => {

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

        const value= BigInt(f.value);
        const poolX= BigInt(f.pool_x);
        const poolY= BigInt(f.pool_y);
        const startEpoch= BigInt(f.start_epoch);
        const endEpoch= BigInt(f.end_epoch);
        const boostMultiplier= BigInt(f.boost_multiplier);
        const poolMiningAmpt = new ValuePerToken(
            BigInt(f.pool_mining_ampt.fields.sum), 
            BigInt(f.pool_mining_ampt.fields.amount), 
        );

        return new PositionInfo({addr, poolInfo, value, poolX, poolY, poolMiningAmpt, startEpoch, endEpoch, boostMultiplier});
    }

    mapResponseToCoinInfo = (response: GetObjectDataResponse) => {

        if (!this.isCoinInfoObject(response)) {
            return null;
        }

        let data = ((response.details as SuiObject).data as SuiMoveObject);
        let coin = {
            type: { name: data.type.replace(/^0x2::coin::Coin<(.+)>$/, "$1"), network: "sui" },
            addr: data.fields.id.id as AddressType,
            balance: BigInt(data.fields.balance)
        } as CoinInfo;
        return coin;
    }

    refreshCachePoolRef = async (force: boolean) => {
        if (force == true || this.cachePoolRefs === null) {
            const cachePoolRefs: Array<{ poolType: PoolType, poolId: AddressType }> = [];
            const poolDfPages = await this.provider.getDynamicFields(this.poolRegistryId);
            const poolDfIds = poolDfPages.data.map(x => x.objectId);
            const poolDfs = await this.provider.getObjectBatch(poolDfIds);
            poolDfs.forEach( poolDf => {
                const data = getObjectFields(poolDf)!;
                const keyType = parseMoveStructTag((data.name?.type) as string);
                const poolXType: string = getTypeTagFullname(keyType.typeParams[0]);
                const poolYType: string = getTypeTagFullname(keyType.typeParams[1]);
                const poolId: string = data.value?.fields.pool_id;
                const poolType: PoolType = {
                    xTokenType: { network: "sui", name: poolXType },
                    yTokenType: { network: "sui", name: poolYType },
                };
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

        // First find the gas coin
        const gasBudget = ctx.gasBudget ?? SuiswapClient.DEFAULT_SWAP_GAS_AMOUNT;
        const gasFee = await this.getGasFeePrice();
        const gas = gasBudget * gasFee;
        const gasCoin = await this.getGasCoin(ctx.accountAddr, [], gas);
        if (gasCoin === null) {
            throw new Error("Cannot find the gas payment or not enough amount for paying the gas");
        }        

        const swapCoinType = (opt.direction === "forward") ? opt.pool.type.xTokenType : opt.pool.type.yTokenType;

        const avaliableSwapCoins = await (await this.getAccountCoins(ctx.accountAddr, [swapCoinType.name])).filter(x => !isSameCoin(x, gasCoin));
        if (avaliableSwapCoins.length === 0) {
            if (isSameCoinType(gasCoin.type, swapCoinType)) {
                throw new Error(`No avalibale coin for swapping when including gas coin, make sure you have at least two coins`);
            }
            else {
                throw new Error(`No avaliable coin for swapping`);
            }
        }

        const [swapCoins, swapCoinsTotalBalance] = this._getCoinsLargerThanBalance(avaliableSwapCoins, opt.amount);
        if (swapCoinsTotalBalance < opt.amount) {
            throw new Error(`Not enough balance for swapping, max amount: ${swapCoinsTotalBalance}, target amount: ${opt.amount}`);
        }

        let transacation: SuiMoveCallTransaction = {
            packageObjectId: this.getPackageAddress(),
            module: "pool",
            function: (opt.direction == "forward") ? "swap_x_to_y" : "swap_y_to_x",
            typeArguments: [opt.pool.type.xTokenType.name, opt.pool.type.yTokenType.name],
            arguments: [
                opt.pool.addr,
                swapCoins.map(x => x.addr),
                opt.amount.toString(),
                opt.minOutputAmount?.toString() ?? "0"
            ],
            gasPayment: gasCoin.addr,
            gasBudget: Number(gasBudget)
        };

        return transacation;
    }

    _generateMoveTransaction_AddLiqudity = async (opt: TransactionOperation.AddLiqudity, ctx: SuiswapClientTransactionContext) => {
        const pool = opt.pool;
        const xAmount = opt.xAmount;
        const yAmount = opt.yAmount;

        if (((xAmount <= 0 || xAmount > NumberLimit.U64_MAX) || (yAmount <= 0 || yAmount > NumberLimit.U64_MAX))) {
            throw new Error(`Invalid input amount for adding liqudity: ${xAmount} or minOutputAmount: ${yAmount}`);
        }

        if (pool.freeze) {
            throw new Error(`Cannot not swap for freeze pool: ${pool.addr}`);
        }

        // Temporarily comment due to Suiet bug
        // if ((await this.isConnected()) == false) {
        //     throw new Error("Wallet is not connected");
        // }

        const accountAddr = ctx.accountAddr;
        if (accountAddr === null) {
            throw new Error("Cannot get the current account address from wallet")
        }

        const gasBudget = ctx.gasBudget ?? SuiswapClient.DEFAULT_ADD_LIQUIDITY_GAS_AMOUNT;
        const gasFee = await this.getGasFeePrice();
        const gas = gasBudget * gasFee;
        const gasCoin = await this.getGasCoin(accountAddr, [], gas);
        if (gasCoin === null) {
            throw new Error("Cannot find the gas payment or not enough amount for paying the gas");
        }

        // Getting the both x coin and y coin
        const avaliableSwapCoins = await this.getAccountCoins(accountAddr, [pool.type.xTokenType.name, pool.type.yTokenType.name]);
        const avaliableSwapXCoins = avaliableSwapCoins.filter(c => isSameCoinType(c.type, pool.type.xTokenType) && !isSameCoin(c, gasCoin));
        const avaliableSwapYCoins = avaliableSwapCoins.filter(c => isSameCoinType(c.type, pool.type.yTokenType) && !isSameCoin(c, gasCoin));

        if (avaliableSwapXCoins.length === 0) {
            if (isSameCoinType(pool.type.xTokenType, gasCoin.type)) {
                throw new Error(`The account doesn't hold the coin for adding liqudity: ${pool.type.xTokenType.name}, make sure you have at least one ${pool.type.xTokenType.name} coin for adding liqudity and one for paying the gas`);
            }
            else {
                throw new Error(`The account doesn't hold the coin for adding liqudity: ${pool.type.xTokenType.name}`);
            }
        }
        if (avaliableSwapYCoins.length === 0) {
            if (isSameCoinType(pool.type.yTokenType, gasCoin.type)) {
                throw new Error(`The account doesn't hold the coin for adding liqudity: ${pool.type.yTokenType.name}, make sure you have at least one ${pool.type.yTokenType.name} coin for adding liqudity and one for paying the gas`);
            }
            else {
                throw new Error(`The account doesn't hold the coin for adding liqudity: ${pool.type.yTokenType.name}`);
            }
        }

        const [swapXCoins, swapXCoinsTotalAmount] = this._getCoinsLargerThanBalance(avaliableSwapXCoins, xAmount);
        const [swapYCoins, swapYCoinsTotalAmount] = this._getCoinsLargerThanBalance(avaliableSwapYCoins, yAmount);

        if (swapXCoinsTotalAmount < xAmount) {
            throw new Error(`The account has insuffcient balance for coin ${pool.type.xTokenType.name}, current balance: ${swapXCoinsTotalAmount}, expected: ${xAmount}`);
        }
        if (swapYCoinsTotalAmount < yAmount) {
            throw new Error(`The account has insuffcient balance for coin ${pool.type.yTokenType.name}, current balance: ${swapYCoinsTotalAmount}, expected: ${yAmount}`);
        }

        // Entry: entry fun add_liquidity<X, Y>(pool: &mut Pool<X, Y>, x: Coin<X>, y: Coin<Y>, in_x_amount: u64, in_y_amount: u64, ctx: &mut TxContext)
        let transacation: SuiMoveCallTransaction = {
            packageObjectId: this.getPackageAddress(),
            module: "pool",
            function: "add_liquidity",
            typeArguments: [pool.type.xTokenType.name, pool.type.yTokenType.name],
            arguments: [
                pool.addr,
                swapXCoins.map(c => c.addr),
                swapYCoins.map(c => c.addr),
                xAmount.toString(),
                yAmount.toString(),
                opt.unlockEpoch.toString()
            ],
            gasPayment: gasCoin.addr,
            gasBudget: Number(gasBudget)
        };

        return transacation;
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
        const gasBudget = ctx.gasBudget ?? SuiswapClient.DEFAULT_REMOVE_LIQUIDITY_GAS_AMOUNT;
        const gasPrice = await this.getGasFeePrice();
        const gas = gasBudget * gasPrice;
        const gasCoin = await this.getGasCoin(accountAddr, [], gas);

        if (gasCoin === null) {
            throw new Error("Cannot find the gas payment or not enough amount for paying the gas");
        }

        // Entry: entry fun remove_liquidity<X, Y>(pool: &mut Pool<X, Y>, lsp: Coin<LSP<X, Y>>, lsp_amount: u64, ctx: &mut TxContext)
        let transacation: SuiMoveCallTransaction = {
            packageObjectId: this.packageAddr,
            module: "pool",
            function: "remove_liquidity",
            typeArguments: [pool.type.xTokenType.name, pool.type.yTokenType.name],
            arguments: [
                pool.addr,
                this.tokenBankId,
                position.addr,
                amount.toString()
            ],
            gasPayment: gasCoin.addr,
            gasBudget: Number(gasBudget)
        };

        return transacation;
    }

    _generateMoveTransaction_Raw = async (opt: TransactionOperation.Raw, ctx: SuiswapClientTransactionContext) => { 
        const accountAddr = ctx.accountAddr;


        // Serialize the transaction
        const t = opt.transaction;
        const tCtx: TransactionTypeSerializeContext = { packageAddr: this.packageAddr, sender: accountAddr };
        const sp = t.function.split("::");
        const packageObjectId = sp[0].replace("@", this.packageAddr);
        const module_ = sp[1];
        const function_ = sp[2];
        const typeArguments = t.type_arguments.map(ty => ty.replace("@", this.packageAddr));
        const arguments_ = t.arguments.map(arg => ( SuiSerializer.toJsonArgument(arg, tCtx) as SuiJsonValue) );

        const gasBudget = ctx.gasBudget ?? SuiswapClient.DEFAULT_GAS_BUDGET;
        const gasFee = await this.getGasFeePrice();
        const gas = gasBudget * gasFee;
        
        const gasCoin = await this.getGasCoin(accountAddr, [], gas);
        if (gasCoin === null) {
            throw new Error("Cannot find the gas payment or not enough amount for paying the gas");
        }

        let transacation: SuiMoveCallTransaction = {
            packageObjectId, 
            module: module_, 
            function: function_, 
            typeArguments, 
            arguments: arguments_, 
            gasBudget: Number(gasBudget),
            gasPayment: gasCoin.addr
        }

        return transacation;
    }
}


class SuiSerializer {
    static _SERIALIZE_TRANSACTION_HAS_PREPARED = false;

    static _normalizArgument = (v: TransacationArgument, ctx: TransactionTypeSerializeContext) => {
        if (SuiSerializer._SERIALIZE_TRANSACTION_HAS_PREPARED === false) {
            SuiSerializer._SERIALIZE_TRANSACTION_HAS_PREPARED = true;
            if (!SuiBCS.hasType(Object.getPrototypeOf(SuiBCS) .ADDRESS)) {
                SuiBCS.registerAddressType(Object.getPrototypeOf(SuiBCS).ADDRESS, 20);
            }
        }
        return TransactionArgumentHelper.normalizeTransactionArgument(v, ctx);
    }

    static toBCSArgument = (v: TransacationArgument, ctx: TransactionTypeSerializeContext) => {
        const vs = SuiSerializer._normalizArgument(v, ctx);
    
        const tag = vs[0];
        const value = vs[1] as (string | number | bigint);
        if (tag === "address") {    
            return SuiBCS.ser(Object.getPrototypeOf(SuiBCS).ADDRESS, value.toString()).toBytes();
        }
        else if (tag === "string") {
            return SuiBCS.ser(Object.getPrototypeOf(SuiBCS).STRING, value.toString()).toBytes();
        }
        else if (tag === "u8") {
            return SuiBCS.ser(Object.getPrototypeOf(SuiBCS).U8, value).toBytes();
        }
        else if (tag === "u16") {
            throw Error("Sui doesn't support u16 type bcs serialization");
        }
        else if (tag === "u32") {
            return SuiBCS.ser(Object.getPrototypeOf(SuiBCS).U32, value).toBytes();
        }
        else if (tag === "u64") {
            return SuiBCS.ser(Object.getPrototypeOf(SuiBCS).U64, value).toBytes();
        }
        else if (tag === "u128") {
            return SuiBCS.ser(Object.getPrototypeOf(SuiBCS).U128, value).toBytes();
        }
        throw Error(`[SuiSerializer] BCS serialize error on argument: ${v}`)
    }

    static toJsonArgument = (v: TransacationArgument, ctx: TransactionTypeSerializeContext) => {
        const vs = SuiSerializer._normalizArgument(v, ctx);

        const tag = vs[0];
        const value = vs[1];
        if (tag === "address" || tag === "string") {    
            return value.toString();
        }
        else if (tag === "u8" || tag === "u16" || tag === "u32") {
            return Number(value);
        }
        else if (tag === "u64" || tag === "u128") {
            return value.toString();
        }
        throw Error(`[SuiSerializer] Json serialize error on argument: ${v}`)
    }
}