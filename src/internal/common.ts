import { formatNumeric } from "./format";
import { BigIntConstants } from "./constants";
import { bigintPow, StableSwapHelper } from "./utils";
import { Client } from "./client";
import { MoveType } from "./move-type";

export function uniqArray<T>(array: Array<T>): Array<T> {
    return Array.from(new Set(array));
}

export function uniqArrayOn<T, K>(array: Array<T>, on: (t: T) => K): Array<T> {
    const map = new Map(array.map(t => [on(t), t] as [K, T]));
    return Array.from(map.values());
}

export type SwapType = "v2" | "stable";
export type FeeDirection = "X" | "Y";
export type TokenHolderRewardType = "Balance" | "AutoBuyBack"
export type NetworkType = "sui" | "aptos";
export type AddressType = string;
export type PoolDirectionType = "forward" | "reverse";
export type TxHashType = string;
export type EndPointType = "mainnet" | "testnet" | "devnet";

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

export type CoinType = MoveType;

export class CoinInfo {
    type: CoinType;
    addr: AddressType;
    balance: bigint;
    raw?: any;

    static equals =(a: CoinInfo, b: CoinInfo) => {
        return a.addr === b.addr;
    }

    constructor(p: { type: CoinType, addr: AddressType, balance: bigint, raw?: any }) {
        this.type = p.type;
        this.addr = p.addr;
        this.balance = p.balance;
        this.raw = p.raw;
    }

    uuid = () => {
        return `CoinInfo[${this.addr}]`
    }
}

export class PoolType {
    xTokenType: CoinType;
    yTokenType: CoinType

    constructor(p: { xTokenType: CoinType, yTokenType: CoinType }) {
        this.xTokenType = p.xTokenType;
        this.yTokenType = p.yTokenType;
    }

    uuid = () => {
        return `PoolType<${this.xTokenType.str(), this.yTokenType.str()}>`
    }
};

export class ValuePerToken {
    sum: bigint;
    amount: bigint;

    constructor(sum: bigint, amount: bigint) {
        this.sum = sum;
        this.amount = amount;
    }

    isAmountZero = () => {
        return (this.amount == BigIntConstants.ZERO && this.sum === BigIntConstants.ZERO);
    }

    static diff = (v1: ValuePerToken, v2: ValuePerToken, mul: bigint) => {
        const v1Zero = v1.isAmountZero();
        const v2Zero = v2.isAmountZero();
        const zero = BigIntConstants.ZERO;
        const one = BigIntConstants.ONE;

        const s1 = v1Zero ? zero : v1.sum;
        const a1 = v1Zero ? one : v1.amount;
        const s2 = v2Zero ? zero : v2.sum;
        const a2 = v2Zero ? one : v2.amount;

        const n1 = s1 * a2;
        const n2 = s2 * a1;
        const d = a1 * a2;

        if (n1 >= n2) {
            return (n1 - n2) * mul / d;
        }
        else {
            return BigIntConstants.ZERO;
        }
    }
}

export class EPoolNotAvaliableReason {
    static Freeze = "Pool is freezed";
    static Empty = "Pool is empty, deposit first";
    static Unknown = "Pool is not avaliable";
}

export class PositionInfo {
    addr: AddressType;
    poolInfo: PoolInfo;
    value: bigint;
    poolX: bigint;
    poolY: bigint;
    poolMiningAmpt: ValuePerToken;
    startEpoch: bigint;
    endEpoch: bigint;
    boostMultiplier: bigint;
    ratio?: DemicalFormat;

    constructor(props: {
        addr: AddressType,
        poolInfo: PoolInfo,
        value: bigint,
        poolX: bigint,
        poolY: bigint,
        poolMiningAmpt: ValuePerToken,
        startEpoch: bigint,
        endEpoch: bigint,
        boostMultiplier: bigint,
        ratio?: DemicalFormat
    }) {
        this.addr = props.addr;
        this.poolInfo = props.poolInfo;
        this.value = props.value;
        this.poolX = props.poolX;
        this.poolY = props.poolY;
        this.poolMiningAmpt = props.poolMiningAmpt;
        this.startEpoch = props.startEpoch;
        this.endEpoch = props.endEpoch;
        this.boostMultiplier = props.boostMultiplier;
        this.ratio = props.ratio;
    }

    partial: (ratio: DemicalFormat) => PositionInfo = (ratio: DemicalFormat) => {
        return new PositionInfo({
            addr: this.addr,
            poolInfo: this.poolInfo,
            value: this.value,
            poolX: this.poolX,
            poolY: this.poolY,
            poolMiningAmpt: this.poolMiningAmpt,
            startEpoch: this.startEpoch,
            endEpoch: this.endEpoch,
            boostMultiplier: this.boostMultiplier,
            ratio: ratio
        });
    }

    balance: () => bigint = () => {
        if (this.ratio === undefined) {
            return this.value;
        }

        const bl = this.value * this.ratio.value / bigintPow(BigIntConstants._1E1, this.ratio.demical);
        if (bl < BigIntConstants.ZERO) {
            return BigIntConstants.ZERO;
        }
        else if (bl > this.value) {
            return this.value;
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
        return `${this.addr}`
    }
}

export interface PoolBoostMultiplierData {
    epoch: number,
    boostMultiplier: bigint
}

export interface PoolInfoInitializeInfo {
    addr: string, 
    typeString: string, 
    index: number,
    type: PoolType,
    swapType: SwapType, 

    lspSupply: bigint, 
    freeze: boolean
    
    boostMultiplierData: Array<PoolBoostMultiplierData>,

    feeDirection: FeeDirection, 
    adminFee: bigint, 
    lpFee: bigint, 
    thFee: bigint,
    withdrawFee: bigint,

    x: bigint, 
    y: bigint, 
    xAdmin: bigint,
    yAdmin: bigint,
    xTh: bigint,
    yTh: bigint,

    stableAmp: bigint,
    stableXScale: bigint, 
    stableYScale: bigint, 

    totalTradeX: bigint,
    totalTradeY: bigint,
    totalTradeXLastEpoch: bigint,
    totalTradeYLastEpoch: bigint,
    totalTradeXCurrentEpoch: bigint,
    totalTradeYCurrentEpoch: bigint,

    thRewardType: TokenHolderRewardType,
    thRewardX: bigint,
    thRewardY: bigint
    thRewardXSupply: bigint,
    thRewardYSupply: bigint,
    thRewardNepoch: bigint,
    thRewardStartEpcoh: bigint,
    thRewardEndEpoch: bigint,
    thRewardTotalStakeAmount: bigint,
    thRewardTotalStakeBoost: bigint,

    miningSpeed: bigint,
    miningAmpt: ValuePerToken,
    miningLastEpoch: bigint,
}

export class PoolInfo {

    static BPS_SCALING: bigint = BigInt("10000");

    addr: string; 
    typeString: string; 
    index: number;
    type: PoolType;
    swapType: SwapType; 

    lspSupply: bigint; 
    freeze: boolean
    
    boostMultiplierData: Array<PoolBoostMultiplierData>;

    feeDirection: FeeDirection; 
    adminFee: bigint; 
    lpFee: bigint; 
    thFee: bigint;
    withdrawFee: bigint;

    x: bigint; 
    y: bigint; 
    xAdmin: bigint;
    yAdmin: bigint;
    xTh: bigint;
    yTh: bigint;

    stableAmp: bigint;
    stableXScale: bigint; 
    stableYScale: bigint; 

    totalTradeX: bigint;
    totalTradeY: bigint;
    totalTradeXLastEpoch: bigint;
    totalTradeYLastEpoch: bigint;
    totalTradeXCurrentEpoch: bigint;
    totalTradeYCurrentEpoch: bigint;

    thRewardType: TokenHolderRewardType;
    thRewardX: bigint;
    thRewardY: bigint
    thRewardXSupply: bigint;
    thRewardYSupply: bigint;
    thRewardNepoch: bigint;
    thRewardStartEpcoh: bigint;
    thRewardEndEpoch: bigint;
    thRewardTotalStakeAmount: bigint;
    thRewardTotalStakeBoost: bigint;

    miningSpeed: bigint;
    miningAmpt: ValuePerToken;
    miningLastEpoch: bigint;

    _fAdmin: number
    _fLp: number
    _fTh: number;
    _aAdmin: number;
    _aLp: number;
    _aTh: number;

    constructor(props: PoolInfoInitializeInfo) {
        this.addr = props.addr;
        this.typeString = props.typeString;
        this.index = props.index;
        this.type = props.type;
        this.swapType = props.swapType;
        this.lspSupply = props.lspSupply;
        this.freeze = props.freeze;
        this.boostMultiplierData = props.boostMultiplierData;
        this.feeDirection = props.feeDirection;
        this.adminFee = props.adminFee;
        this.lpFee = props.lpFee;
        this.thFee = props.thFee;
        this.withdrawFee = props.withdrawFee;
        this.x = props.x;
        this.y = props.y;
        this.xAdmin = props.xAdmin;
        this.yAdmin = props.yAdmin;
        this.xTh = props.xTh;
        this.yTh = props.yTh;
        this.stableAmp = props.stableAmp;
        this.stableXScale = props.stableXScale;
        this.stableYScale = props.stableYScale;
        this.totalTradeX = props.totalTradeX;
        this.totalTradeY = props.totalTradeY;
        this.totalTradeXLastEpoch = props.totalTradeXLastEpoch;
        this.totalTradeYLastEpoch = props.totalTradeYLastEpoch;
        this.totalTradeXCurrentEpoch = props.totalTradeXCurrentEpoch;
        this.totalTradeYCurrentEpoch = props.totalTradeYCurrentEpoch;
        this.thRewardType = props.thRewardType;
        this.thRewardX = props.thRewardX;
        this.thRewardY = props.thRewardY;
        this.thRewardXSupply = props.thRewardXSupply;
        this.thRewardYSupply = props.thRewardYSupply;
        this.thRewardNepoch = props.thRewardNepoch;
        this.thRewardStartEpcoh = props.thRewardStartEpcoh;
        this.thRewardEndEpoch = props.thRewardEndEpoch;
        this.thRewardTotalStakeAmount = props.thRewardTotalStakeAmount;
        this.thRewardTotalStakeBoost = props.thRewardTotalStakeBoost;
        this.miningSpeed = props.miningSpeed;
        this.miningAmpt = props.miningAmpt;
        this.miningLastEpoch = props.miningLastEpoch;

        this._fAdmin = Number(this.adminFee) / 10000.0;
        this._fLp = Number(this.lpFee) / 10000.0;
        this._fTh = Number(this.thFee) / 10000.0;
        this._aAdmin = 1.0 - this._fAdmin;
        this._aLp = 1.0 - this._fLp;
        this._aTh = 1.0 - this._fTh;;
    }

    static equals = (a: PoolInfo, b: PoolInfo) => {
        return (a.addr === b.addr) 
            && MoveType.equals(a.type.xTokenType, b.type.xTokenType) 
            && MoveType.equals(a.type.yTokenType, b.type.yTokenType);
    }

    totalAdminFee = () => {
        return this.adminFee;
    }

    totalLpFee = () => {
        return this.lpFee;
    }

    totalThFee = () => {
        return this.thFee;
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
        let value: number;
        if (this.swapType == "v2") {
            value = this._getPriceGeneral(xDecimal, yDecimal);
        }
        else {
            value = this._getPriceStable(xDecimal, yDecimal);
        }

        return isNaN(value) ? 0.0 : value;
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

    getXToYAmount = (dx: bigint) => {
        const X = this.x;
        const Y = this.y;
        const feeDirection = this.feeDirection;
        const adminFee = this.adminFee;
        const thFee = this.thFee;
        const lpFee = this.lpFee;

        if (feeDirection == "X") {
            const dfee = dx * adminFee / PoolInfo.BPS_SCALING
            dx -= dfee

            const dfee_th_x = dx * thFee / PoolInfo.BPS_SCALING;
            dx -= dfee_th_x
        }

        const dx_lp = (dx * lpFee) / PoolInfo.BPS_SCALING
        dx -= dx_lp;
        
        let dy = (this.swapType == "v2") ? this._computeAmount(dx, X, Y) : this._computeAmountStable(dx, X, Y, this.stableXScale, this.stableYScale);

        if (feeDirection == "Y") {
            const dfee = dy * adminFee / PoolInfo.BPS_SCALING
            dy -= dfee

            const dfee_th_y = dy * thFee / PoolInfo.BPS_SCALING
            dy -= dfee_th_y
        }

        return dy;
    }

    getYToXAmount = (dy: bigint) => {
        const X = this.x;
        const Y = this.y;
        const feeDirection = this.feeDirection;
        const adminFee = this.adminFee;
        const thFee = this.thFee;
        const lpFee = this.lpFee;

        if (feeDirection == "Y") {
            const dfee = dy * adminFee / PoolInfo.BPS_SCALING
            dy -= dfee

            const dfee_th_y = dy * thFee / PoolInfo.BPS_SCALING
            dy -= dfee_th_y
        }

        const dy_lp = (dy * lpFee) / PoolInfo.BPS_SCALING
        dy -= dy_lp
        
        let dx = (this.swapType == "v2") ? this._computeAmount(dy, Y, X) : this._computeAmountStable(dy, Y, X, this.stableYScale, this.stableXScale);
        if (feeDirection == "X") {
            const dfee = dx * adminFee / PoolInfo.BPS_SCALING
            dx -= dfee

            const dfee_th_x = dx * thFee / PoolInfo.BPS_SCALING
            dx -= dfee_th_x
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
        const x = (this.totalTradeXCurrentEpoch > this.totalTradeXLastEpoch) ? this.totalTradeXCurrentEpoch : this.totalTradeXLastEpoch;
        const y = (this.totalTradeYCurrentEpoch > this.totalTradeYLastEpoch) ? this.totalTradeYCurrentEpoch : this.totalTradeYLastEpoch;
        return this._volumeToValue(client, primaryCoinPrice, Number(x), Number(y), xCoinUi, yCoinUi);
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

        if (MoveType.equals(primaryCoinType, this.type.xTokenType)) {
            px = primaryCoinPrice;
        } else if (xCoinUi.extensions?.stableCoin !== undefined) {
            px = 1.0;
        }

        if (MoveType.equals(primaryCoinType, this.type.yTokenType)) {
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
        // TODO
        return null;
        // const startTime = this.totalTrade24hLastCaptureTime;
        // const endTime = this.lastTradeTime;

        // if (this.x <= BigIntConstants.ZERO || this.y <= BigIntConstants.ZERO || endTime <= startTime) {
        //     return null;
        // }

        // const fee = Number(this.totalLpFee()) / 10000;

        // const fn = (tx: number, x: number, st: number, et: number) => {
        //     // Note: The 0.5 here is because we add both trade for x and y when swapping x to y. But the lp fee is only taken from x
        //     const tf = Number(tx) / (et - st) * 86400 * (fee * 0.5); // Total fee generate in one day
        //     const apr = (tf / x) * 365;
        //     return apr;
        // }

        // const aprX = fn(Number(this.totalTradeX24h), Number(this.x), startTime, endTime);
        // const aprY = fn(Number(this.totalTradeY24h), Number(this.y), startTime, endTime);

        // return (aprX + aprY) * 0.5;

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
        if (MoveType.equals(x, x_) && MoveType.equals(y, y_)) {
            return "forward" as PoolDirectionType
        }
        else if (MoveType.equals(x, y_) && MoveType.equals(y, x_)) {
            return "reverse" as PoolDirectionType;
        }
        return null;
    }

    isCapableSwappingForCoins = (x: CoinType, y: CoinType) => {
        const x_ = this.type.xTokenType;
        const y_ = this.type.yTokenType;
        return this.isInitialized() && this.isAvaliableForSwap() && (MoveType.equals(x, x_) && MoveType.equals(y, y_)) || (MoveType.equals(x, y_) && MoveType.equals(y, x_));
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

    uuid: () => string = () => {
        return `PoolInfo[${(this.type.uuid())}-${this.addr}]`;
    }
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