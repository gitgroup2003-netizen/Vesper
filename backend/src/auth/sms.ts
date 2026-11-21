import { Injectable, Logger } from '@nestjs/common';

export abstract class SmsSender {
  abstract send(phoneE164: string, message: string): Promise<void>;
}
export const SMS_SENDER = Symbol('SMS_SENDER');

/** Dev adapter: logs the message. Swap for an Africa's Talking / Twilio adapter in production. */
@Injectable()
export class ConsoleSmsSender extends SmsSender {
  private readonly log = new Logger('SMS');
  async send(phone: string, message: string): Promise<void> {
    this.log.warn(`[DEV SMS] to=${phone} :: ${message}`);
  }
}
