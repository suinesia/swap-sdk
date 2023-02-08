import { bcs as SuiBCS, SuiJsonValue, JsonRpcProvider as SuiJsonRpcProvider, MoveCallTransaction as SuiMoveCallTransaction, SuiMoveObject, SuiObject, GetObjectDataResponse } from '@mysten/sui.js';
import { MoveTemplateType, PoolInfo, CoinType, PoolType, CoinInfo, AddressType, TxHashType, PositionInfo, CommonTransaction, WeeklyStandardMovingAverage, uniqArrayOn, isSameCoinType, isSameCoin } from './common';
import { TransactionOperation, TransacationArgument, TransactionArgumentHelper, TransactionTypeSerializeContext } from './transaction';
import { BigIntConstants, NumberLimit, SuiConstants } from './constants';
import { Client, ClientFeatures } from './client';

export interface SuiswapClientTransactionContext {
    accountAddr: AddressType;
    gasBudget?: bigint;
}

export class SuiswapClient extends Client {
    static DEFAULT_GAS_BUDGET = BigInt(2000);

    static DEFAULT_SWAP_GAS_AMOUNT = BigInt(1000);
    static DEFAULT_ADD_LIQUIDITY_GAS_AMOUNT = BigInt(1000);
    static DEFAULT_MINT_TEST_COIN_GAS_AMOUNT = BigInt(1000);
    static DEFAULT_REMOVE_LIQUIDITY_GAS_AMOUNT = BigInt(1000);
    
    packageAddr: AddressType;
    testTokenSupplyAddr: AddressType;
    owner: AddressType;
    endpoint: string;
    provider: SuiJsonRpcProvider;
    
    gasFeePrice: bigint;

    constructor({ packageAddr, testTokenSupplyAddr, owner, endpoint } : { packageAddr: AddressType, testTokenSupplyAddr: AddressType, owner: AddressType, endpoint: string }) {
        super();
        this.packageAddr = packageAddr;
        this.testTokenSupplyAddr = testTokenSupplyAddr;
        this.owner = owner;
        this.endpoint = endpoint;
        this.provider = new SuiJsonRpcProvider(this.endpoint);

        // Initialize as one (before version 0.22)
        this.gasFeePrice = BigIntConstants.ONE;
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
        return this._mapResponseToPoolInfo(response);
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
        else if (t === "mint-test-coin") {
            return SuiswapClient.DEFAULT_MINT_TEST_COIN_GAS_AMOUNT;
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
        const packageAddr = this.packageAddr;
        const packageOwner = this.owner;

        const poolInfoIds = (await this.provider.getObjectsOwnedByAddress(packageOwner))
            .filter((obj) => { return (obj.type === `${packageAddr}::pool::PoolCreateInfo`) })
            .map((obj) => obj.objectId);

        const poolInfoObjects = await this.provider.getObjectBatch(poolInfoIds);

        const poolIds = poolInfoObjects.map((x) => {
            const details = x.details as SuiObject;
            const object = details.data as SuiMoveObject;
            const poolId = object.fields["pool_id"] as string;
            return poolId;
        });

        const poolInfos = (await this.provider.getObjectBatch(poolIds)).map((response) => this._mapResponseToPoolInfo(response)).filter(x => x !== null) as PoolInfo[];

        const coinTypes = uniqArrayOn(poolInfos.flatMap((poolInfo) => [poolInfo.type.xTokenType, poolInfo.type.yTokenType]), coinType => coinType.name);
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

    getAccountPoolLspCoins = async (accountAddr: string) => {
        const packageAddr = this.packageAddr;

        const coinFilter = [`${packageAddr}::pool::LSP<0x2::sui::SUI, ${packageAddr}::pool::TestToken>`];
        const coins = (await this.getSortedAccountCoinsArray(accountAddr, coinFilter))[0];
        return coins;
    }

    getAccountPositionInfos = (pools: PoolInfo[], coins: CoinInfo[]) => {
        const packageAddr = this.packageAddr;
        const lspPrefix = `${packageAddr}::pool::LSP`;

        const lspCoins = coins.filter(coin => coin.type.name.startsWith(lspPrefix));
        const lspPositionInfos = lspCoins
            .map(coin => {
                try {
                    const template = MoveTemplateType.fromString(coin.type.name)!;
                    const xCoinTypeName = template.typeArgs[0];
                    const yCoinTypeName = template.typeArgs[1];

                    const poolInfos = pools.filter((p) => (p.type.xTokenType.name === xCoinTypeName && p.type.yTokenType.name === yCoinTypeName))
                    if (poolInfos.length === 0) return null;

                    // Get the largest one
                    let poolInfo = poolInfos[0];
                    for (const p of poolInfos) {
                        if (p.lspSupply > poolInfo.lspSupply) {
                            poolInfo = p;
                        }
                    }

                    return new PositionInfo(poolInfo, coin);
                } catch { }

                return null;
            })
            .filter(x => x !== null) as PositionInfo[];
        return lspPositionInfos;
    }

    getExplorerHrefForTxHash = (txHash: TxHashType) => {
        return `https://explorer.devnet.sui.io/transactions/${txHash}`;
    }

    getTransactions: (accountAddr: string, limit: number) => Promise<CommonTransaction[]> = async (_accountAddr: string, _limit: number) => {
        // TODO: SUI
        return [];
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
        else if (opt.operation === "mint-test-coin") {
            return (await this._generateMoveTransaction_MintTestCoin(opt as TransactionOperation.MintTestCoin, ctx));
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

    _mapResponseToPoolInfo = (response: GetObjectDataResponse) => {
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
                type: poolType,
                typeString: typeString,
                addr: fields.id.id,

                index: 0, // TODO: SUI
                swapType: "v2", // TODO: SUI

                x: BigInt(fields.x),
                y: BigInt(fields.y),
                lspSupply: BigInt(fields.lsp_supply.fields.value),

                feeDirection: "X",

                stableAmp: BigIntConstants.ZERO, // TODO: SUI
                stableXScale: BigIntConstants.ZERO, // TODO: SUI
                stableYScale: BigIntConstants.ZERO, // TODO: SUI

                freeze: fields.freeze,
                lastTradeTime: 0, // TODO

                totalTradeX: BigIntConstants.ZERO,
                totalTradeY: BigIntConstants.ZERO,
                totalTrade24hLastCaptureTime: 0,
                totalTradeX24h: BigIntConstants.ZERO,
                totalTradeY24h: BigIntConstants.ZERO,

                kspSma: WeeklyStandardMovingAverage.Zero(),

                adminFee: BigInt(fields.admin_fee),
                lpFee: BigInt(fields.lp_fee),
                incentiveFee: BigIntConstants.ZERO,
                connectFee: BigIntConstants.ZERO,
                withdrawFee: BigIntConstants.ZERO
            });

            return poolInfo;
        } catch (_e) {
            return null;
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
                yAmount.toString()
            ],
            gasPayment: gasCoin.addr,
            gasBudget: Number(gasBudget)
        };

        return transacation;
    }

    _generateMoveTransaction_MintTestCoin = async (opt: TransactionOperation.MintTestCoin, ctx: SuiswapClientTransactionContext) => {;
        const amount = opt.amount;
        const packageAddr = this.getPackageAddress();

        if (amount <= 0 || amount > NumberLimit.U64_MAX) {
            throw new Error(`Invalid input amount for minting test token: ${amount}`);
        }

        // Get test tokens
        let accountTestTokens: Array<CoinInfo> = [];
        try {
            accountTestTokens = (await this.getSortedAccountCoinsArray(ctx.accountAddr, [`${packageAddr}::pool::TestToken`]))[0];
        } catch {
            throw new Error("Network error while trying to get the test token info from account");
        }

        const accountTestToken = (accountTestTokens.length > 0) ? accountTestTokens[0] : null;

        const gasBudget = ctx.gasBudget ?? SuiswapClient.DEFAULT_MINT_TEST_COIN_GAS_AMOUNT;
        const gasFee = await this.getGasFeePrice();
        const gas = gasBudget * gasFee;
        const gasCoin = await this.getGasCoin(ctx.accountAddr, [], gas);
        if (gasCoin === null) {
            throw new Error("Cannot find the gas payment or not enough amount for paying the gas");
        }

        let transacation: SuiMoveCallTransaction = (accountTestToken === null) ? (
            // entry fun mint_test_token(token_supply: &mut TestTokenSupply, amount: u64, recipient: address, ctx: &mut TxContext)
            {
                packageObjectId: packageAddr,
                module: "pool",
                function: "mint_test_token",
                typeArguments: [],
                arguments: [
                    this.testTokenSupplyAddr,
                    amount.toString(),
                    ctx.accountAddr
                ],
                gasPayment: gasCoin.addr,
                gasBudget: Number(gasBudget)
            }
        ) : (
            // entry fun mint_test_token_merge(token_supply: &mut TestTokenSupply, amount: u64, coin: &mut Coin<TestToken>, ctx: &mut TxContext) {
            {
                packageObjectId: packageAddr,
                module: "pool",
                function: "mint_test_token_merge",
                typeArguments: [],
                arguments: [
                    this.testTokenSupplyAddr,
                    amount.toString(),
                    accountTestToken.addr
                ],
                gasPayment: gasCoin.addr,
                gasBudget: Number(gasBudget)
            }
        );

        return transacation;
    }

    _generateMoveTransaction_RemoveLiquidity = async (opt: TransactionOperation.RemoveLiquidity, ctx: SuiswapClientTransactionContext) => {
        const position = opt.positionInfo;
        const pool = position.poolInfo;
        const lspCoin = position.lspCoin;
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
        const gasCoin = await this.getGasCoin(accountAddr, [lspCoin.addr], gas);

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
                [lspCoin.addr],
                amount.toString(),
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