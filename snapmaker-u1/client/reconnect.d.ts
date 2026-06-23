import type { EnrollContext } from '@adapter-sdk';
export declare function pollReconnect(ctx: EnrollContext, hostname: string, start?: number, hintSent?: boolean): Promise<void>;
