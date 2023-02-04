import { BigIntConstants } from "./constants";

export const delay = (ms: number) => { return new Promise(resolve => setTimeout(resolve, ms)) };

export const retry = async ({times, ms, fn}: {times: number, ms?: number, fn: () => Promise<void>}) => {
    for (let __i = 0; __i < times; ++__i) {
        try {
            await fn();
            break;
        } catch (_e) {
            if (__i + 1 < times) {
                if (ms !== undefined) {
                    await delay(ms);
                }
                continue;
            }
            else {
                throw _e;
            }
        }
    }
}

export const groupBy = <T, K extends keyof any>(arr: T[], key: (i: T) => K) =>
    arr.reduce((groups, item) => {
        (groups[key(item)] ||= []).push(item);
        return groups;
    }, {} as Record<K, T[]> as Record<K, T[]>
);

export const bigintPow = (a: bigint, b: number) => {
    return Array(b).fill(BigInt(a)).reduce((a, b) => a * b, BigInt(1));
}

export class StableSwapHelper {
    static compuateDNext = (dInit: bigint, dProd: bigint, sumX: bigint, A: bigint) => {
        const leverage = sumX * BigIntConstants.TWO * A;
        const numerator = dInit * (BigIntConstants.TWO * dProd + leverage);
        const denominator = (dInit * (BigIntConstants.TWO * A - BigIntConstants.ONE)) + (BigIntConstants.THREE * dProd);
        return numerator / denominator;
    }

    static computeD = (b: bigint, q: bigint, A: bigint) => {
        if (b + q == BigIntConstants.ZERO) {
            return BigIntConstants.ZERO;
        }

        let d = b + q;
        
        for (let __i = 0; __i < 256; ++__i) {
            let dProd = d;
            dProd = dProd * d / (BigIntConstants.TWO * b);
            dProd = dProd * d / (BigIntConstants.TWO * q);
            const dPrev = d;
            d = StableSwapHelper.compuateDNext(d, dProd, b + q, A);
            const diff = d - dPrev;
            if (diff === BigIntConstants.ONE || diff === BigIntConstants.MINUS_ONE || diff === BigIntConstants.ZERO) {
                break;
            }
        }

        return d;
    }

    static computeY = (dx: bigint, x: bigint, y: bigint, A: bigint) => {
        const d = StableSwapHelper.computeD(x, y, A);
        let c = (d * d) / (BigIntConstants.TWO * (x + dx));
        c = (c * d) / (BigIntConstants.FOUR * A);
        const b = (d / (BigIntConstants.TWO * A)) + (x + dx);

        let yy = d;
        for (let __i = 0; __i < 256; ++__i) {
            const yPrev = yy;
            const yn = yy * yy + c;
            const yd = BigIntConstants.TWO * yy + b - d;
            yy = yn / yd;
            const diff = yy - yPrev;
            if (diff === BigIntConstants.ONE || diff === BigIntConstants.MINUS_ONE || diff === BigIntConstants.ZERO) {
                break;
            }
        }

        return (y - yy - BigIntConstants.ONE);
    }
     

    static computeDDecimal = (b: bigint, q: bigint, A: bigint, bd: number, qd: number) => {
        const md = Math.max(bd, qd);
        StableSwapHelper.computeD(b * bigintPow(BigIntConstants._1E1, md - bd), q * bigintPow(BigIntConstants._1E1, md - qd), A);
    }

    static computeYDecimal = (dx: bigint, x: bigint, y: bigint, A: bigint, xd: number, yd: number) => {
        const md = Math.max(xd, yd);
        const xs = bigintPow(BigIntConstants._1E1, md - xd);
        const ys = bigintPow(BigIntConstants._1E1, md - yd);
        const dy = StableSwapHelper.computeY(dx * xs, x * xs, y * ys, A)
        return dy / ys;
    }
}