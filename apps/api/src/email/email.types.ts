export type AuthEmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
};

export type EmailDelivery = {
  provider: string;
  providerId: string | null;
};

export interface EmailProvider {
  readonly name: string;
  send(message: AuthEmailMessage): Promise<EmailDelivery>;
}
