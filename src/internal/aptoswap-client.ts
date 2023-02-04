import { AptosAccount, AptosClient, FaucetClient as AptosFaucetClient, Types as AptosTypes } from 'aptos';
import { MoveTemplateType, PoolInfo, CoinType, PoolType, CoinInfo, AddressType, PositionInfo, CommonTransaction, WeeklyStandardMovingAverage, uniqArrayOn, SwapTransactionData, DepositTransactionData, WithdrawTransactionData, PoolDirectionType, isSameCoinType } from './common';
import { AptosSerializer, TransactionOperation, TransactionOptions, TransactionType, TransactionTypeSerializeContext } from './transaction';
import { AptosConstants, BigIntConstants } from './constants';
import { Client } from './client';
import axios from "axios"

export interface AptoswapClientTransactionContext {
    accountAddr: AddressType;
    gasBudget?: bigint;
    gasPrice?: bigint;
}

export class AptoswapClient extends Client {

    static DEFAULT_GAS_BUDGET = BigInt(2000);
    static DEFAULT_EXPIRATION_SECS = 90;
    static DEFAULT_EXECUTE_TIMEOUT_SECS = 30;
    static HOST_DEPLOY_JSON_PATH = "api/deploy.json"

    packageAddr: AddressType;
    client: AptosClient;
    faucetClient?: AptosFaucetClient;
    minGasPrice: bigint;

    /**
     * Generate AptoswapClient by providing the host website
     * 
     * @param host the host for the website, for example: "https://aptoswap.net"
     * 
     * @returns An AptoswapClient if we could generate the client from host or null otherwise
     */
    static fromHost = async (host: string) => {
        // Generate something like "https://aptoswap.net/api/deploy.json"
        const deployJsonHref = host + (host.endsWith('/') ? "" : "/") + AptoswapClient.HOST_DEPLOY_JSON_PATH;

        try {
            const response = await axios.get(deployJsonHref);
            const endpoint: string = response.data.endpoint;
            const faucetEndpoint: string | undefined = response.data.faucetEndpoint;
            const packageAddr: string = response.data.aptoswap?.package;
            let minGasPrice: bigint | null = null;

            const gasScheduleV2Client =  new AptosClient(endpoint)
            const gasScheduleV2 = ((await gasScheduleV2Client.getAccountResource("0x1", "0x1::gas_schedule::GasScheduleV2")).data as any).entries;
            for (const entry of (gasScheduleV2) ?? []) {
                if (entry.key === "txn.min_price_per_gas_unit") {
                    minGasPrice = BigInt(entry.val);
                }
            }

            return new AptoswapClient({ packageAddr, endpoint, faucetEndpoint, minGasPrice: minGasPrice ?? BigIntConstants._1E2});

        } catch {
            return null;
        }
    }

    constructor({ packageAddr, endpoint, faucetEndpoint, minGasPrice }: { packageAddr: AddressType, endpoint: string, faucetEndpoint?: string, minGasPrice: bigint }) {
        super();

        this.packageAddr = packageAddr;
        this.client = new AptosClient(endpoint);

        if (faucetEndpoint !== undefined) {
            this.faucetClient = new AptosFaucetClient(endpoint, faucetEndpoint);
        }

        this.minGasPrice = minGasPrice;
    }

    getAptosClient = () => {
        return this.client;
    }

    getPackageAddress = () => {
        return this.packageAddr;
    }

    static _isAccountNotExistError = (e: any) => {
        if ((e instanceof Error) && (e as any).status === 404 && (e as any).body !== undefined) {
            const body = (e as any).body as any;
            if (body.error_code === "account_not_found") {
                return true;
            }
        }
        return false;
    }

    static _isAccountNotHaveResource = (e: any) => {
        if ((e instanceof Error) && (e as any).status === 404 && (e as any).body !== undefined) {
            const body = (e as any).body as any;
            if (body.error_code === "account_not_found") {
                return true;
            }
        }
        return false;
    }

    static _checkAccountExists = (e: any) => {
        if (AptoswapClient._isAccountNotExistError(e)) {
            throw new Error("Account not found");
        }
    }

    static _checkAccountResource = (e: any) => {
        if (AptoswapClient._isAccountNotHaveResource(e)) {
            throw new Error("Resource not found not found");
        }
    }
 
    static _mapResourceToPoolInfo = (addr: AddressType, resource: AptosTypes.MoveResource) => {
        try {
            const typeString = resource.type;
            const mtt = MoveTemplateType.fromString(typeString)!;

            const xCoinType = {
                network: "aptos",
                name: mtt.typeArgs[0]
            } as CoinType;

            const yCoinType = {
                network: "aptos",
                name: mtt.typeArgs[1]
            } as CoinType;

            const data = resource.data as any;

            const poolType = { xTokenType: xCoinType, yTokenType: yCoinType } as PoolType;
            const poolInfo = new PoolInfo({
                type: poolType,
                typeString: typeString,
                addr: addr,

                index: Number(data.index),
                swapType: (Number(data.pool_type) === 100) ? "v2" : "stable",

                x: BigInt(data.x.value),
                y: BigInt(data.y.value),
                lspSupply: BigInt(data.lsp_supply),

                feeDirection: (Number(data.fee_direction) === 200) ? "X" : "Y",

                stableAmp: BigInt(data.stable_amp), 
                stableXScale: BigInt(data.stable_x_scale),
                stableYScale: BigInt(data.stable_y_scale),

                freeze: data.freeze,

                lastTradeTime: Number(data.last_trade_time ?? 0),

                totalTradeX: BigInt(data.total_trade_x),
                totalTradeY: BigInt(data.total_trade_y),
                totalTrade24hLastCaptureTime: Number(data.total_trade_24h_last_capture_time),
                totalTradeX24h: BigInt(data.total_trade_x_24h),
                totalTradeY24h: BigInt(data.total_trade_y_24h),

                kspSma: new WeeklyStandardMovingAverage(
                    Number(data.ksp_e8_sma.start_time),
                    Number(data.ksp_e8_sma.current_time),
                    BigInt(data.ksp_e8_sma.a0),
                    BigInt(data.ksp_e8_sma.a1),
                    BigInt(data.ksp_e8_sma.a2),
                    BigInt(data.ksp_e8_sma.a3),
                    BigInt(data.ksp_e8_sma.a4),
                    BigInt(data.ksp_e8_sma.a5),
                    BigInt(data.ksp_e8_sma.a6),

                    BigInt(data.ksp_e8_sma.c0),
                    BigInt(data.ksp_e8_sma.c1),
                    BigInt(data.ksp_e8_sma.c2),
                    BigInt(data.ksp_e8_sma.c3),
                    BigInt(data.ksp_e8_sma.c4),
                    BigInt(data.ksp_e8_sma.c5),
                    BigInt(data.ksp_e8_sma.c6),
                ),

                adminFee: BigInt(data.admin_fee),
                lpFee: BigInt(data.lp_fee),
                incentiveFee: BigInt(data.incentive_fee),
                connectFee: BigInt(data.connect_fee),
                withdrawFee: BigInt(data.withdraw_fee)
            });

            return poolInfo;
        } catch {}

        return null;
    }

    getPool = async (poolInfo: PoolInfo) => {
        try {
            const resource = await this.client.getAccountResource(poolInfo.addr, poolInfo.typeString);
            return AptoswapClient._mapResourceToPoolInfo(poolInfo.addr, resource);
        }
        catch (e) {
            if (AptoswapClient._isAccountNotExistError(e)) {
                return null;
            }
            else {
                throw e;
            }
        }
    }

    getCoinsAndPools: (() => Promise<{ coins: CoinType[]; pools: PoolInfo[]; }>) = async () => {
        // First
        let poolInfosRaw: AptosTypes.MoveResource[] = [];

        try {
            poolInfosRaw = (await this.client.getAccountResources(this.packageAddr))
            .filter(resource => resource.type.startsWith(`${this.packageAddr}::pool::Pool`));
        } catch (e) {
            if (AptoswapClient._isAccountNotExistError(e)) {
                return { coins: [], pools: [] };
            }
            else {
                throw e;
            }
        }

        const poolInfos = poolInfosRaw
            .map((pr) => AptoswapClient._mapResourceToPoolInfo(this.packageAddr, pr))
            .filter(x => x !== null) as PoolInfo[];

        const coinTypes = uniqArrayOn(poolInfos.flatMap((poolInfo) => [poolInfo.type.xTokenType, poolInfo.type.yTokenType]), coinType => coinType.name);
        return { coins: coinTypes, pools: poolInfos };
    }

    getAccountCoins: (accountAddr: AddressType, filter?: string[] | undefined) => Promise<CoinInfo[]> = async (accountAddr: AddressType, filter?: Array<string>) => {
        let coinsRaw: AptosTypes.MoveResource[] = [];
        try {
            coinsRaw = (await this.client.getAccountResources(accountAddr))
        } catch (e) {
            if (AptoswapClient._isAccountNotExistError(e)) {
                return [];
            }
            else {
                throw e;
            }
        }

        const coins = coinsRaw
            .map(c => {
                const template = MoveTemplateType.fromString(c.type);
                if (template === null || template.head !== "0x1::coin::CoinStore") { return null; }

                // Filter the coin type
                const coinType = { network: "aptos", name: template.typeArgs[0] } as CoinType;
                if (filter !== undefined && filter.indexOf(coinType.name) === -1) { return null; }

                try {
                    const balance = BigInt((c.data as any).coin.value);
                    if (balance <= BigIntConstants.ZERO) {
                        return null;
                    }
                    return {
                        type: coinType,
                        addr: accountAddr,
                        balance: balance
                    } as CoinInfo
                } catch {
                    return null;
                }
            })
            .filter(c => c !== null) as CoinInfo[];

        return coins;
    }

    getAccountPositionInfos = (pools: PoolInfo[], coins: CoinInfo[]) => {        
        const lspPrefix = `${this.packageAddr}::pool::LSP`;

        const lspCoins = coins.filter(coin => coin.type.name.startsWith(lspPrefix))
        const lspPositionInfos = lspCoins
            .map(coin => {
                try {
                    if (coin.balance <= BigIntConstants.ZERO) {
                        return null;
                    }
                    const template = MoveTemplateType.fromString(coin.type.name);
                    if (template === null || template.typeArgs.length !== 2) {
                        return null;
                    }

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

    getTransactions: (accountAddr: string, limit: number) => Promise<CommonTransaction[]> = async (accountAddr: string, limit: number) => {
        const transactions = await this.client.getAccountTransactions(accountAddr, { limit: limit }) as AptosTypes.UserTransaction[]; 

        const swapTransactions = transactions
            .filter( r => {
                const payload = r.payload as AptosTypes.EntryFunctionPayload;
                return (payload.function.includes("swap_x_to_y") || payload.function.includes("swap_y_to_x"));
            }).map( r => {
                const success = r.success;
                const payload = r.payload as AptosTypes.EntryFunctionPayload;
                const direction: PoolDirectionType = payload.function.includes("swap_x_to_y") ? "forward" : "reverse";
                const poolType: PoolType = {
                    xTokenType: { network: "aptos", name: payload.type_arguments[0] },
                    yTokenType: { network: "aptos", name: payload.type_arguments[1] }
                };
                let inAmount = BigInt(payload.arguments[0]);
                let outAmount: bigint | undefined = undefined;
                const swapTokenEvents = r.events.filter(e => e.type.endsWith("pool::SwapTokenEvent"));
                if (swapTokenEvents.length > 0) {
                    const swapTokenEvent = swapTokenEvents[0];
                    inAmount = BigInt(swapTokenEvent.data.in_amount);
                    outAmount = BigInt(swapTokenEvent.data.out_amount);
                }

                const href = this.getExplorerHrefForTxHash(r.hash);

                return {
                    type: "swap",
                    id: r.hash,
                    timestamp: Number(r.timestamp) / 1e6,
                    success: success,
                    href: href,
                    data: {
                        poolType,
                        direction,
                        inAmount,
                        outAmount
                    } as SwapTransactionData
                } as CommonTransaction
            });

        const depositTransactions = transactions
            .filter( r => {
                const payload = r.payload as AptosTypes.EntryFunctionPayload;
                return payload.function.includes("add_liquidity")
            }).map( r => {
                const success = r.success;
                const payload = r.payload as AptosTypes.EntryFunctionPayload;
                const poolType: PoolType = {
                    xTokenType: { network: "aptos", name: payload.type_arguments[0] },
                    yTokenType: { network: "aptos", name: payload.type_arguments[1] }
                };
                let inAmountX = BigInt(payload.arguments[0]);
                let inAmountY = BigInt(payload.arguments[1]);

                const href = this.getExplorerHrefForTxHash(r.hash);
                
                return {
                    type: "deposit",
                    id: r.hash,
                    timestamp: Number(r.timestamp) / 1e6,
                    success: success,
                    href: href,
                    data: {
                        poolType,
                        inAmountX,
                        inAmountY
                    } as DepositTransactionData
                } as CommonTransaction
            });

        const withdrawTransactions = transactions
            .filter( r => {
                const payload = r.payload as AptosTypes.EntryFunctionPayload;
                return payload.function.includes("remove_liquidity")
            }).map( r => {
                const success = r.success;
                const payload = r.payload as AptosTypes.EntryFunctionPayload;
                const poolType: PoolType = {
                    xTokenType: { network: "aptos", name: payload.type_arguments[0] },
                    yTokenType: { network: "aptos", name: payload.type_arguments[1] }
                };
                let outAmountX: bigint | undefined;
                let outAmountY: bigint | undefined;
                const liqudityEvents = r.events.filter(r => r.type.endsWith("pool::LiquidityEvent"));
                if (liqudityEvents.length > 0) {
                    const liqudityEvent = liqudityEvents[0];
                    outAmountX = BigInt(liqudityEvent.data.x_amount);
                    outAmountY = BigInt(liqudityEvent.data.y_amount);
                }      

                const href = this.getExplorerHrefForTxHash(r.hash);

                return {
                    type: "withdraw",
                    id: r.hash,
                    timestamp: Number(r.timestamp) / 1e6,
                    success: success,
                    href: href,
                    data: {
                        poolType,
                        outAmountX,
                        outAmountY
                    } as WithdrawTransactionData
                } as CommonTransaction
            });

        const txs = [...swapTransactions, ...depositTransactions, ...withdrawTransactions];
        txs.sort((a, b) => (a.timestamp < b.timestamp) ? 1 : (a.timestamp > b.timestamp ? -1 : 0));
        return txs;
    }

    getExplorerHrefForTxHash = (txHash: string) => {
        return `https://explorer.aptoslabs.com/txn/${txHash}`
    }

    getPrimaryCoinType = () => {
        return AptosConstants.APTOS_COIN_TYPE;
    }

    getPrimaryCoinPrice: () => Promise<number> = async () => {
        // return (38.535 + Math.random() * 0.03) / (10 ** 8);
        const res = await axios.get("https://api.coingecko.com/api/v3/simple/price?ids=aptos&vs_currencies=usd");
        const priceUi = Number(res.data.aptos?.usd);
        const price = priceUi;
        return price;
    }

    getGasFeePrice: () => Promise<bigint> = async () => {
        return this.minGasPrice;
    }

    generateTransactionType = async (opt: TransactionOperation.Any, ctx: AptoswapClientTransactionContext) => {
        if (opt.operation === "swap") {
            return (await this._generateTransactionType_Swap(opt as TransactionOperation.Swap, ctx));
        }
        else if (opt.operation === "add-liqudity") {
            return (await this._generateTransactionType_AddLiqudity(opt as TransactionOperation.AddLiqudity, ctx));
        }
        else if (opt.operation === "mint-test-coin") {
            return (await this._generateTransactionType_MintTestCoin(opt as TransactionOperation.MintTestCoin, ctx));
        }
        else if (opt.operation === "remove-liqudity") {
            return (await this._generateTransactionType_RemoveLiquidity(opt as TransactionOperation.RemoveLiquidity, ctx));
        }
        throw new Error(`Not implemented`);
    }

    generateEntryFuntionPayload = async (opt: TransactionOperation.Any, accountAddr: AddressType, opts: TransactionOptions) => {
        const transcationCtx: AptoswapClientTransactionContext = {
            accountAddr: accountAddr,
            gasBudget: opts.maxGasAmount ?? AptoswapClient.DEFAULT_GAS_BUDGET,
            gasPrice: opts.gasUnitPrice ?? this.minGasPrice
        };
        
        const serializeCtx: TransactionTypeSerializeContext = {
            packageAddr: this.getPackageAddress(),
            sender: accountAddr
        };

        const t = await this.generateTransactionType(opt, transcationCtx);
        const payload = AptosSerializer.toEntryFunctionPayload(t, serializeCtx);
        return payload;
    }

    submit = async (opt: TransactionOperation.Any, account: AptosAccount, opts: TransactionOptions) => { 
        const accountAddr = account.address().toString();
        const payload = await this.generateEntryFuntionPayload(opt, accountAddr, opts);

        const rawTransaction = await this.client.generateTransaction(
            accountAddr, 
            payload, 
            {
                max_gas_amount: (opts.maxGasAmount ?? AptoswapClient.DEFAULT_GAS_BUDGET).toString(),
                gas_unit_price: (opts.gasUnitPrice ?? this.minGasPrice).toString(),
                expiration_timestamp_secs: (Math.floor(Date.now() / 1000) + (opts?.expirationSecond ?? AptoswapClient.DEFAULT_EXPIRATION_SECS)).toString()
            }
        );
        
        const signedTransaction = await this.client.signTransaction(account, rawTransaction);
        const pendingTransaction = await this.client.submitTransaction(signedTransaction);
        return pendingTransaction.hash;
    }

    execute = async (opt: TransactionOperation.Any, account: AptosAccount, opts: TransactionOptions, timeout?: number) => {
        const txHash = await this.submit(opt, account, opts);
        const result = await this.client.waitForTransactionWithResult(txHash, { timeoutSecs: timeout ?? AptoswapClient.DEFAULT_EXECUTE_TIMEOUT_SECS, checkSuccess: false });
        return (result as AptosTypes.UserTransaction);
    }

    checkGasFeeAvaliable = async (accountAddr: AddressType, usedAmount: bigint, estimateGasAmount: bigint) => {
        let balance = BigIntConstants.ZERO;
        try {
            const resource = await this.client.getAccountResource(accountAddr, "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>");
            balance = BigInt((resource.data as any).coin?.value);
        } catch (e) {
            AptoswapClient._checkAccountExists(e);
            AptoswapClient._checkAccountResource(e);
            throw e;
        }

        if (balance < estimateGasAmount + usedAmount) {
            return false;
        }

        return true;
    }

    _generateTransactionType_Swap = async (opt: TransactionOperation.Swap, ctx: AptoswapClientTransactionContext) => {

        const gasBudget = ctx.gasBudget ?? AptoswapClient.DEFAULT_GAS_BUDGET;

        const pool = opt.pool;
        const direction = opt.direction;
        const amount = opt.amount;
        const minOutputAmount = opt.minOutputAmount;

        const packageAddr = this.getPackageAddress();
        const function_name = (direction === "forward") ? "swap_x_to_y" : "swap_y_to_x";
        const sourceCoinType = (direction === "forward") ? (pool.type.xTokenType) : (pool.type.yTokenType);

        const isGasEnough = await this.checkGasFeeAvaliable(
            ctx.accountAddr,
            isSameCoinType(sourceCoinType, this.getPrimaryCoinType()) ? amount : BigIntConstants.ZERO,
            gasBudget
        );
        if (!isGasEnough) {
            throw new Error("Not enough gas for swapping");
        }

        // public entry fun swap_x_to_y<X, Y>(user: &signer, pool_account_addr: address, in_amount: u64, min_out_amount: u64) acquires Pool {
        const transaction: TransactionType = {
            function: `${packageAddr}::pool::${function_name}`,
            type_arguments: [pool.type.xTokenType.name, pool.type.yTokenType.name],
            arguments: [
                amount,
                minOutputAmount ?? BigIntConstants.ZERO
            ]
        };

        return transaction;
    }

    _generateTransactionType_AddLiqudity = async (opt: TransactionOperation.AddLiqudity, ctx: AptoswapClientTransactionContext) => {

        const gasBudget = (ctx.gasBudget ?? AptoswapClient.DEFAULT_GAS_BUDGET);

        const pool = opt.pool;
        const xAmount = opt.xAmount;
        const yAmount = opt.yAmount;
        const packageAddr = this.getPackageAddress();
        const aptosCoinType = this.getPrimaryCoinType();

        let depositGasCoinAmount: bigint = BigIntConstants.ZERO;
        if (isSameCoinType(pool.type.xTokenType, aptosCoinType)) {
            depositGasCoinAmount = xAmount;
        }
        else if (isSameCoinType(pool.type.yTokenType, aptosCoinType)) {
            depositGasCoinAmount = yAmount;
        }

        const isGasEnough = await this.checkGasFeeAvaliable(ctx.accountAddr, depositGasCoinAmount, gasBudget);
        if (!isGasEnough) {
            throw new Error("Not enough gas for adding liquidity");
        }

        // public entry fun add_liquidity<X, Y>(user: &signer, pool_account_addr: address, x_added: u64, y_added: u64) acquires Pool, LSPCapabilities {
        const transaction: TransactionType = {
            function: `${packageAddr}::pool::add_liquidity`,
            type_arguments: [pool.type.xTokenType.name, pool.type.yTokenType.name],
            arguments: [
                xAmount,
                yAmount
            ]
        };

        return transaction;
    }

    _generateTransactionType_MintTestCoin = async (opt: TransactionOperation.MintTestCoin, ctx: AptoswapClientTransactionContext) => {
        const gasBudget = (ctx.gasBudget ?? AptoswapClient.DEFAULT_GAS_BUDGET);

        const amount = opt.amount;
        const packageAddr = this.getPackageAddress();
        const accountAddr = ctx.accountAddr;

        const isGasEnough = await this.checkGasFeeAvaliable(accountAddr, BigIntConstants.ZERO, gasBudget);
        if (!isGasEnough) {
            throw new Error("Not enough gas for minting test coin");
        }

        // public entry fun mint_test_token(owner: &signer, amount: u64, recipient: address) acquires SwapCap, TestTokenCapabilities {}
        const transaction: TransactionType = {
            function: `${packageAddr}::pool::mint_test_token`,
            type_arguments: [],
            arguments: [
                amount,
                ["address", accountAddr]
            ]
        };

        return transaction;
    }

    _generateTransactionType_RemoveLiquidity = async (opt: TransactionOperation.RemoveLiquidity, ctx: AptoswapClientTransactionContext) => {
        const gasBudget = ctx.gasBudget ?? AptoswapClient.DEFAULT_GAS_BUDGET;

        const positionInfo = opt.positionInfo;
        const packageAddr = this.getPackageAddress();
        const pool = positionInfo.poolInfo;
        const balance = positionInfo.balance();

        const isGasEnough = await this.checkGasFeeAvaliable(ctx.accountAddr, BigIntConstants.ZERO, gasBudget);
        if (!isGasEnough) {
            throw new Error("Not enough gas for removing liquidity");
        }

        // public entry fun remove_liquidity<X, Y>(user: &signer, pool_account_addr: address, lsp_amount: u64) acquires Pool, LSPCapabilities {
        const transaction: TransactionType = {
            function: `${packageAddr}::pool::remove_liquidity`,
            type_arguments: [pool.type.xTokenType.name, pool.type.yTokenType.name],
            arguments: [
                balance
            ]
        };

        return transaction;
    }

}