import { formatNumeric } from "./format";
import { BigIntConstants } from "./constants";
import { bigintPow, StableSwapHelper } from "./utils";
import { Client } from "./client";

export function uniqArray<T>(array: Array<T>): Array<T> {
    return Array.from(new Set(array));
}

export function uniqArrayOn<T, K>(array: Array<T>, on: (t: T) => K): Array<T> {
    const map = new Map(array.map(t => [on(t), t] as [K, T]));
    return Array.from(map.values());
}

export type SwapType = "v2" | "stable";
export type FeeDirection = "X" | "Y";
export type NetworkType = "sui" | "aptos";
export type AddressType = string;
export type PoolDirectionType = "forward" | "reverse";
export type TxHashType = string;

export class DemicalFormat {
    value: bigint;
    demical: number;

    constructor(value: bigint, demical: number) {
        this.value = value;
        this.demical = (demical < 0) ? 0 : demical;
    }

    toString: (fixed?: boolean) => string = (fixed?: boolean) => {
        if (this.demical <= 0) { 
            return formatNumeric(this.value.toString()); 
        }
        let vs = Array(this.demical).fill("0").join("") +  this.value.toString();
        // Add "."
        vs = vs.slice(0, -this.demical) + "." + vs.slice(-this.demical);
        vs = formatNumeric(vs);

        const fixed_ = fixed ?? false;
        if (fixed_ && this.demical > 0) {
            if (vs.indexOf(".") === -1) {
                vs += ".";
            }
            const currentDemical = (vs.length - 1 - vs.indexOf("."));
            let appendDemical = this.demical - currentDemical;
            if (appendDemical < 0) { 
                appendDemical = 0;
            }
            vs += Array(appendDemical).fill("0").join("");
        }

        return vs;
    }

    toNumber = () => {
        return Number(this.value) / (10 ** this.demical);
    }

    static fromString: (s: string) => DemicalFormat | null = (s_: string) => {
        // Format numberic
        if (s_.match(/(^[0-9]+$)|(^[0-9]+\.[0-9]*$)/) === null) {
            return null;
        }

        // Second digit check when the first digit is 0, we do not accept 00... but we accept 0x
        if (s_.length >= 2 && s_[0] === '0' && s_[1] === '0') {
            return null;
        }

        let s = formatNumeric(s_);

        let demical = s.length - 1 - s.indexOf('.');
        // Demical not presented
        if (demical >= s.length) {
            demical = 0;
        }

        try {
            // Remove . and parse to BigInt
            const value = BigInt(s.replace('.', ''));
            return new DemicalFormat(value, demical);
        } catch {}

        return null;
    }

    canAlignTo = (r: DemicalFormat | number) => {
        const rDemical = (typeof r === "number") ? r : r.demical;
        return this.demical <= rDemical;
    }

    alignTo = (r: DemicalFormat | number): DemicalFormat => {
        const rDemical = (typeof r === "number") ? r : r.demical;
        const mul = bigintPow(BigInt(10), rDemical - this.demical);
        return new DemicalFormat(this.value * mul, rDemical)
    }
}

export interface CoinType {
    network: NetworkType;
    name: string;
}

export const getCoinTypeUuid = (c: CoinType) => {
    return `CoinType[${c.network}-${c.name}]`;
}

export const isSameCoinType = (a: CoinType, b: CoinType) => {
    return (a.network === b.network) && (a.name === b.name);
}

export interface CoinInfo {
    type: CoinType;
    addr: AddressType;
    balance: bigint;
}

export const isSameCoin = (a: CoinInfo, b: CoinInfo) => {
    // Note: For sui ecosystem, we only need to check address For aptos, since all the addr are equal for single account, we need to check the reset.
    return isSameCoinType(a.type, b.type) && (a.addr === b.addr) && (a.balance === b.balance);
}

export const getCoinInfoUuid = (c: CoinInfo) => {
    return `CoinInfo[${getCoinTypeUuid(c.type)}-${c.addr}]`
}

export interface LSPCoinType {
    xTokenType: CoinType;
    yTokenType: CoinType;
}

export const getLspCoinTypeUuid = (l: LSPCoinType) => {
    return `LSPCoinType[${getCoinTypeUuid(l.xTokenType)}-${getCoinTypeUuid(l.yTokenType)}]`
}

export interface PoolType {
    xTokenType: CoinType;
    yTokenType: CoinType
};

export const getPoolTypeUuid = (p: PoolType) => {
    return `PoolType[${getCoinTypeUuid(p.xTokenType)}-${getCoinTypeUuid(p.yTokenType)}]`
}

export class WeeklyStandardMovingAverage {
    start_time: number;
    current_time: number;
    a0: bigint;
    a1: bigint;
    a2: bigint;
    a3: bigint;
    a4: bigint;
    a5: bigint;
    a6: bigint;
    c0: bigint;
    c1: bigint;
    c2: bigint;
    c3: bigint;
    c4: bigint;
    c5: bigint;
    c6: bigint;

    static Zero = () => {
        return new WeeklyStandardMovingAverage(
            0, 
            0,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO
        );
    }

    constructor(start_time: number, current_time: number, a0: bigint, a1: bigint, a2: bigint, a3: bigint, a4: bigint, a5: bigint, a6: bigint, c0: bigint, c1: bigint, c2: bigint, c3: bigint, c4: bigint, c5: bigint, c6: bigint) {
        this.start_time = start_time;
        this.current_time = current_time;
        this.a0 = a0;
        this.a1 = a1;
        this.a2 = a2;
        this.a3 = a3;
        this.a4 = a4;
        this.a5 = a5;
        this.a6 = a6;
        this.c0 = c0;
        this.c1 = c1;
        this.c2 = c2;
        this.c3 = c3;
        this.c4 = c4;
        this.c5 = c5;
        this.c6 = c6;
    }
}

export class MoveTemplateType {
    head: string;
    typeArgs: Array<string>;

    constructor(head: string, typeArgs: string[]) {
        this.head = head;
        this.typeArgs = typeArgs;
    }

    static fromString(s: string): MoveTemplateType | null {
        try {
            // Remove empty space
            const ms = s.match(/^(.+?)<(.*)>$/) as RegExpMatchArray;
            const head = ms[1];
            const inner = ms[2];
            let typeArgs: string[] = [];
            let braceCounter: number = 0;

            let currentArg = "";
            for (let i = 0; i < inner.length; i += 1) {

                const c = inner[i];
                const nc = (i + 1 < inner.length) ? inner[i + 1] : ""

                if (c === '<') { braceCounter += 1; }
                else if (c === '>') { braceCounter -= 1; }

                if (c === ',' && braceCounter === 0) { 
                    if (currentArg !== "") {
                        typeArgs.push(currentArg);
                    }
                    currentArg = "";
                    if (nc === ' ') {
                        i += 1;
                    }
                }
                else {
                    currentArg += c;
                }
            }

            if (currentArg !== "") {
                typeArgs.push(currentArg);
            }

            return { head, typeArgs }
        } catch {}

        return null;
    }
}

export class EPoolNotAvaliableReason {
    static Freeze = "Pool is freezed";
    static Empty = "Pool is empty, deposit first";
    static Unknown = "Pool is not avaliable";
}


export class PositionInfo {
    poolInfo: PoolInfo;
    lspCoin: CoinInfo;
    ratio?: DemicalFormat;

    constructor(poolInfo: PoolInfo, lspCoin: CoinInfo, ratio?: DemicalFormat) {
        this.poolInfo = poolInfo;
        this.lspCoin = lspCoin;
        this.ratio = ratio;
    }

    partial: (ratio: DemicalFormat) => PositionInfo = (ratio: DemicalFormat) => {
        return new PositionInfo(this.poolInfo, this.lspCoin, ratio);
    }

    balance: () => bigint = () => {
        if (this.ratio === undefined) {
            return this.lspCoin.balance;
        }

        const bl = this.lspCoin.balance * this.ratio.value / bigintPow(BigIntConstants._1E1, this.ratio.demical);
        if (bl < BigIntConstants.ZERO) {
            return BigIntConstants.ZERO;
        }
        else if (bl > this.lspCoin.balance) {
            return this.lspCoin.balance;
        }
        return bl;
    }

    getShareRatio: () => number = () => {
        if (this.poolInfo.lspSupply === BigIntConstants.ZERO) {
            return 0.0;
        }
        return Number(this.balance()) / Number(this.poolInfo.lspSupply);
    }

    getShareCoinAmounts: () => [bigint, bigint] = () => {
        if (this.poolInfo.lspSupply === BigIntConstants.ZERO) {
            return [BigIntConstants.ZERO, BigIntConstants.ZERO];
        }
        let t = this.balance();
        return [
            t * this.poolInfo.x / this.poolInfo.lspSupply,
            t * this.poolInfo.y / this.poolInfo.lspSupply
        ];
    }

    getUuid: () => string = () => {
        return `PositionInfo[${this.poolInfo.getUuid()}-${getCoinInfoUuid(this.lspCoin)}]`
    }
}

export class PoolInfo {

    static BPS_SCALING: bigint = BigInt("10000");

    type: PoolType;
    typeString: string;
    addr: string;

    index: number;
    swapType: SwapType;
    
    x: bigint;
    y: bigint;
    lspSupply: bigint;

    feeDirection: FeeDirection;

    stableAmp: bigint;
    stableXScale: bigint;
    stableYScale: bigint;

    freeze: boolean;

    lastTradeTime: number;

    totalTradeX: bigint;
    totalTradeY: bigint;
    totalTrade24hLastCaptureTime: number;
    totalTradeX24h: bigint;
    totalTradeY24h: bigint;

    kspSma: WeeklyStandardMovingAverage;

    adminFee: bigint;
    lpFee: bigint;
    incentiveFee: bigint;
    connectFee: bigint;
    withdrawFee: bigint;

    _fAdmin: number;
    _fLp: number;
    _aAdmin: number;
    _aLp: number;

    constructor({ type, typeString, addr, index, swapType, x, y, lspSupply, feeDirection, stableAmp, stableXScale, stableYScale, freeze, lastTradeTime, totalTradeX, totalTradeY, totalTrade24hLastCaptureTime, totalTradeX24h, totalTradeY24h, kspSma, adminFee, lpFee, incentiveFee, connectFee, withdrawFee }: { type: PoolType, typeString: string, addr: string, index: number, swapType: SwapType, x: bigint, y: bigint, lspSupply: bigint, feeDirection: FeeDirection, stableAmp: bigint, stableXScale: bigint, stableYScale: bigint, freeze: boolean, lastTradeTime: number, totalTradeX: bigint, totalTradeY: bigint, totalTrade24hLastCaptureTime: number, totalTradeX24h: bigint, totalTradeY24h: bigint, kspSma: WeeklyStandardMovingAverage, adminFee: bigint, lpFee: bigint, incentiveFee: bigint, connectFee: bigint, withdrawFee: bigint }) {
        this.type = type;
        this.typeString = typeString;
        this.addr = addr;
        this.index = index;
        this.swapType = swapType;
        this.x = x;
        this.y = y;
        this.lspSupply = lspSupply;
        this.feeDirection = feeDirection;
        this.stableAmp = stableAmp;
        this.stableXScale = stableXScale;
        this.stableYScale = stableYScale;
        this.freeze = freeze;
        this.lastTradeTime = lastTradeTime;
        this.totalTradeX = totalTradeX;
        this.totalTradeY = totalTradeY;
        this.totalTrade24hLastCaptureTime = totalTrade24hLastCaptureTime;
        this.totalTradeX24h = totalTradeX24h;
        this.totalTradeY24h = totalTradeY24h;
        this.kspSma = kspSma;
        this.adminFee = adminFee;
        this.lpFee = lpFee;
        this.incentiveFee = incentiveFee;
        this.connectFee = connectFee;
        this.withdrawFee = withdrawFee;

        this._fAdmin = Number(this.adminFee + this.connectFee) / 10000.0;
        this._fLp = Number(this.lpFee + this.incentiveFee) / 10000.0;
        this._aAdmin = 1.0 - this._fAdmin;
        this._aLp = 1.0 - this._fLp;
    }

    totalAdminFee = () => {
        return this.adminFee + this.connectFee;
    }

    totalLpFee = () => {
        return this.incentiveFee + this.lpFee;
    }

    isAvaliableForSwap = () => {
        return this.getNotAvaliableForSwapReason() === null;
    }

    getNotAvaliableForSwapReason = () => {
        if (this.freeze) { 
            return EPoolNotAvaliableReason.Freeze 
        }
        else if (this.x === BigIntConstants.ZERO || this.y === BigIntConstants.ZERO) {
            return EPoolNotAvaliableReason.Empty;
        }

        return null;
    }

    getPrice = (xDecimal: number, yDecimal: number) => {
        if (this.swapType == "v2") {
            return this._getPriceGeneral(xDecimal, yDecimal);
        }
        else {
            return this._getPriceStable(xDecimal, yDecimal);
        }
        return 0.0;
    }

    _getPriceStable = (xDecimal: number, yDecimal: number) => {
        const [pn, pd] = this._getPriceStableRational(xDecimal, yDecimal);
        return Number(pn) / Number(pd);
    }

    _getPriceStableRational = (xDecimal: number, yDecimal: number) => {         
        // Although we could get the stable x scale and stable y scale from the pool info
        // We still use the user-passed argument to get the price
        const A = this.stableAmp;
        const q = this.x;
        const b = this.y;
        const qd = xDecimal;
        const bd = yDecimal;
        const md = Math.max(bd, qd);
        const b1 = b * bigintPow(BigIntConstants._1E1, md - bd);
        const q1 = q * bigintPow(BigIntConstants._1E1, md - qd);
        const d = StableSwapHelper.computeD(b1, q1, A);
        
        const _4A = BigIntConstants.FOUR * A;
        const _2q1 = BigIntConstants.TWO * q1;
        const _2b1 = BigIntConstants.TWO * b1;

        const pn = b1 * (d + _4A * (_2q1 + b1 - d));
        const pd = q1 * (d + _4A * (_2b1 + q1 - d));

        return [pn, pd] as [bigint, bigint]
    }

    _getPriceGeneral = (xDecimal: number, yDecimal: number) => {
        // Define with base token, since X is quote and Y is base
        // which is -1 / (dX / dY) = - dY / dX
        // As X * Y = K 
        // ==> X * dY + Y * dX = 0
        // ==> - dY / dX = Y / X
        if (this.x === BigIntConstants.ZERO) return 0.0;
        const priceAbs = Number(this.y) / Number(this.x);
        const price = priceAbs * (10 ** xDecimal) / (10 ** yDecimal);
        return price;
    }

    getPriceBuy = (xDecimal: number, yDecimal: number) => {
        // Excahnge y to x by taking fee
        return this.getPrice(xDecimal, yDecimal) / (this._aAdmin * this._aLp)
    }

    getPriceSell = (xDecimal: number, yDecimal: number) => {
        // Excahnge x to y by taking fee
        return this.getPrice(xDecimal, yDecimal) * (this._aAdmin * this._aLp);
    }

    getXToYAmount = (dx: bigint) => {
        const x_reserve_amt = this.x;
        const y_reserve_amt = this.y;

        if (this.feeDirection === "X") {
            dx = dx - dx * this.totalAdminFee() / PoolInfo.BPS_SCALING;
        }

        dx = dx - dx * this.totalLpFee() / PoolInfo.BPS_SCALING;
        if (dx < BigIntConstants.ZERO) { return BigIntConstants.ZERO; }

        let dy = (this.swapType == "v2") ? this._computeAmount(dx, x_reserve_amt, y_reserve_amt) : this._computeAmountStable(dx, x_reserve_amt, y_reserve_amt, this.stableXScale, this.stableYScale);
        if (this.feeDirection === "Y") {
            dy = dy - dy * this.totalAdminFee() / PoolInfo.BPS_SCALING;
        }

        return dy;
    }

    getYToXAmount = (dy: bigint) => {
        const x_reserve_amt = this.x;
        const y_reserve_amt = this.y;

        if (this.feeDirection === "Y") {
            dy = dy - dy * this.totalAdminFee() / PoolInfo.BPS_SCALING;
        }

        dy = dy - dy * this.totalLpFee() / PoolInfo.BPS_SCALING;
        if (dy < BigIntConstants.ZERO) { return BigIntConstants.ZERO; }

        let dx = (this.swapType == "v2") ? this._computeAmount(dy, y_reserve_amt, x_reserve_amt) : this._computeAmountStable(dy, y_reserve_amt, x_reserve_amt, this.stableYScale, this.stableXScale);
        if (this.feeDirection === "X") {
            dx = dx - dx * this.totalAdminFee() / PoolInfo.BPS_SCALING;
        }
        
        return dx;
    }

    getXToYMinOutputAmount = (dx: bigint, slippage: number) => {
        const dy = this.getXToYAmount(dx);
        return dy * BigInt(Math.round((10 ** 9) * (1.0 - slippage))) / BigIntConstants._1E9;
    }

    getYToXMinOutputAmount = (dy: bigint, slippage: number) => {
        const dx = this.getYToXAmount(dy);
        return dx * BigInt(Math.round((10 ** 9) * (1.0 - slippage))) / BigIntConstants._1E9;
    }

    getTvl = (client: Client, primaryCoinPrice: number, xCoinUi: CoinUiInfo, yCoinUi: CoinUiInfo) => {
        return this._volumeToValue(client, primaryCoinPrice, Number(this.x), Number(this.y), xCoinUi, yCoinUi);
    }

    getTradeVolumne24h = (client: Client, primaryCoinPrice: number, xCoinUi: CoinUiInfo, yCoinUi: CoinUiInfo) => {
        return this._volumeToValue(client, primaryCoinPrice, Number(this.totalTradeX24h), Number(this.totalTradeY24h), xCoinUi, yCoinUi);
    }

    getTradeVolumne = (client: Client, primaryCoinPrice: number, xCoinUi: CoinUiInfo, yCoinUi: CoinUiInfo) => {
        return this._volumeToValue(client, primaryCoinPrice, Number(this.totalTradeX), Number(this.totalTradeY), xCoinUi, yCoinUi);
    }

    _volumeToValue = (client: Client, primaryCoinPrice: number, tx: number, ty: number, xCoinUi: CoinUiInfo, yCoinUi: CoinUiInfo) => {
        const xDecimal = xCoinUi.demical ?? 0;
        const yDecimal = yCoinUi.demical ?? 0;

        const price = this.getPrice(xDecimal, yDecimal);
        if (price === 0.0) {
            return null;
        }

        const primaryCoinType = client.getPrimaryCoinType();

        // Normalize tx and ty from absolute space to visual space
        tx = tx / (10 ** xDecimal);
        ty = ty / (10 ** yDecimal);

        let px: number | null = null;
        let py: number | null = null;

        if (isSameCoinType(primaryCoinType, this.type.xTokenType)) {
            px = primaryCoinPrice;
        } else if (xCoinUi.extensions?.stableCoin !== undefined) {
            px = 1.0;
        }

        if (isSameCoinType(primaryCoinType, this.type.yTokenType)) {
            py = primaryCoinPrice;
        } else if (yCoinUi.extensions?.stableCoin !== undefined) {
            py = 1.0;
        }

        if (px !== null && py === null) {
            py = px / price;
        }
        else if (px === null && py !== null) {
            px = py * price;
        }

        if (px !== null && py !== null) {
            return px * tx + py * ty;
        }

        return null;
    }

    getApr = () => {
        const startTime = this.totalTrade24hLastCaptureTime;
        const endTime = this.lastTradeTime;

        if (this.x <= BigIntConstants.ZERO || this.y <= BigIntConstants.ZERO || endTime <= startTime) {
            return null;
        }

        const fee = Number(this.totalLpFee()) / 10000;

        const fn = (tx: number, x: number, st: number, et: number) => {
            // Note: The 0.5 here is because we add both trade for x and y when swapping x to y. But the lp fee is only taken from x
            const tf = Number(tx) / (et - st) * 86400 * (fee * 0.5); // Total fee generate in one day
            const apr = (tf / x) * 365;
            return apr;
        }

        const aprX = fn(Number(this.totalTradeX24h), Number(this.x), startTime, endTime);
        const aprY = fn(Number(this.totalTradeY24h), Number(this.y), startTime, endTime);

        return (aprX + aprY) * 0.5;

        // const st = this.kspSma.start_time;
        // const ct = this.kspSma.current_time;

        // if (st < 1) { 
        //     // When st == 0, means no initialized
        //     return null;
        // }

        // let vs = [
        //     (ct >= st + (0 * 86400)) ? (Number(this.kspSma.a0 * BigIntConstants._1E8 / this.kspSma.c0) / 1e16) : null,
        //     (ct >= st + (1 * 86400)) ? (Number(this.kspSma.a1 * BigIntConstants._1E8 / this.kspSma.c1) / 1e16) : null,
        //     (ct >= st + (2 * 86400)) ? (Number(this.kspSma.a2 * BigIntConstants._1E8 / this.kspSma.c2) / 1e16) : null,
        //     (ct >= st + (3 * 86400)) ? (Number(this.kspSma.a3 * BigIntConstants._1E8 / this.kspSma.c3) / 1e16) : null,
        //     (ct >= st + (4 * 86400)) ? (Number(this.kspSma.a4 * BigIntConstants._1E8 / this.kspSma.c4) / 1e16) : null,
        //     (ct >= st + (5 * 86400)) ? (Number(this.kspSma.a5 * BigIntConstants._1E8 / this.kspSma.c5) / 1e16) : null,
        //     (ct >= st + (6 * 86400)) ? (Number(this.kspSma.a6 * BigIntConstants._1E8 / this.kspSma.c6) / 1e16) : null
        // ].filter(x => x !== null) as number[];

        // if (vs.length < 2) {
        //     // Cannot diff
        //     return null;
        // }

        // let dpyc: number = 0.0; // Daily percentage yield (total)
        // let dpyn: number = 0.0; // Counter
        // for (let i = 1; i < vs.length; ++i) {
        //     dpyc += vs[i] - vs[i - 1];
        //     dpyn += 1.0;
        // }

        // const currentKPerLsp = vs[0];
        // const targetKPerLsp = currentKPerLsp + Math.max(0.0, dpyc / dpyn) * 365.0;
        
        // const relAbs = targetKPerLsp / currentKPerLsp; // Relative K increase
        // const relNormalized = Math.sqrt(relAbs); // Relative sqrt(K) increase, could be treated as the x increase or y increase since K = x * y

        // return relNormalized - 1.0;
    }

    getDepositXAmount = (y: bigint) => {
        if (this.y === BigIntConstants.ZERO) { return BigIntConstants.ZERO; }
        return (this.x * y) / this.y;
    }

    getDepositYAmount = (x: bigint) => {
        if (this.x === BigIntConstants.ZERO) { return BigIntConstants.ZERO; }
        return (x * this.y) / this.x;
    }

    getDepositAmount = (xMax: bigint, yMax: bigint) => {
        if (!this.isInitialized() || xMax <= BigIntConstants.ZERO || yMax <= BigIntConstants.ZERO) {
            return [BigIntConstants.ZERO, BigIntConstants.ZERO] as [bigint, bigint]
        };

        let x: bigint = BigIntConstants.ZERO;
        let y: bigint = BigIntConstants.ZERO;

        if (this.getDepositXAmount(yMax) > xMax) {
          x = xMax;
          y = this.getDepositYAmount(xMax);
          y = (y < yMax) ? y : yMax;
        }
        else {
          y = yMax;
          x = this.getDepositXAmount(yMax);
          x = (x < xMax) ? x : xMax;
        }

        return [x, y];
    }

    isInitialized = () => {
        return (this.x > BigIntConstants.ZERO) && (this.y > BigIntConstants.ZERO);
    }

    getSwapDirection = (x: CoinType, y: CoinType) => { 
        const x_ = this.type.xTokenType;
        const y_ = this.type.yTokenType;
        if (isSameCoinType(x, x_) && isSameCoinType(y, y_)) {
            return "forward" as PoolDirectionType
        }
        else if (isSameCoinType(x, y_) && isSameCoinType(y, x_)) {
            return "reverse" as PoolDirectionType;
        }
        return null;
    }

    isCapableSwappingForCoins = (x: CoinType, y: CoinType) => {
        const x_ = this.type.xTokenType;
        const y_ = this.type.yTokenType;
        return this.isInitialized() && this.isAvaliableForSwap() && (isSameCoinType(x, x_) && isSameCoinType(y, y_)) || (isSameCoinType(x, y_) && isSameCoinType(y, x_));
    }

    _computeAmount = (dx: bigint, x: bigint, y: bigint) => {
        const numerator = y * dx;
        const denominator = x + dx;
        const dy = numerator / denominator;
        return dy;    
    }

    _computeAmountStable = (dx: bigint, x: bigint, y: bigint, x_scale: bigint, y_scale: bigint) => {
        const dy_ = StableSwapHelper.computeY(dx * x_scale, x * x_scale, y * y_scale, this.stableAmp);
        return dy_ / y_scale;
    }

    getUuid: () => string = () => {
        return `PoolInfo[${getPoolTypeUuid(this.type)}-${this.addr}]`;
    }
}

export const isSamePool = (a: PoolInfo, b: PoolInfo) => {
    return (a.addr === b.addr) && isSameCoinType(a.type.xTokenType, b.type.xTokenType) && isSameCoinType(a.type.yTokenType, b.type.yTokenType);
}

export interface CommonTransaction {
    id: string;
    href: string;
    type: "swap" | "deposit" | "withdraw";
    success: boolean;
    data: SwapTransactionData | DepositTransactionData   | WithdrawTransactionData;
    timestamp: number;
}

export interface SwapTransactionData {
    poolType: PoolType;
    direction: PoolDirectionType;
    inAmount: bigint;
    outAmount?: bigint;
}

export interface DepositTransactionData {
    poolType: PoolType;
    inAmountX: bigint;
    inAmountY: bigint;
}

export interface WithdrawTransactionData {
    poolType: PoolType;
    outAmountX?: bigint;
    outAmountY?: bigint;
}

export interface CoinUiInfoExtension {
    stableCoin?: "usdc" | "usdt" | "dai" | "busd" | "other";
}

export interface CoinUiInfoWithoutId {
    /// The description of the token
    symbol: string;
    /// The name of the token
    name?: string;
    /// The demical of the token
    demical?: number;
    /// The supply of the token
    supply?: number;
    /// The logo url of the token, should be fit to the <Link> in next.js
    logoUrl?: string;
    /// Extensions
    extensions?: CoinUiInfoExtension;
}

export interface CoinUiInfo extends CoinUiInfoWithoutId {
    /// The id of the token
    id: string;
}

export type GetCoinUiFn = (coin: CoinType) => CoinUiInfo;

export const getCoinUiDemicalStep = (coinUiInfo: CoinUiInfo) => {
    if (coinUiInfo.demical === undefined || coinUiInfo.demical === null) {
        return undefined;
    }

    if (coinUiInfo.demical <= 0) {
        return "1";
    }

    return "0." + "0".repeat(coinUiInfo.demical - 1) + "1";
}