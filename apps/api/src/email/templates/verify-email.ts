import { buildTransactionalEmail } from "./transactional-email";

export function verifyEmailTemplate(url: string, expiresInMinutes: number, supportEmail?: string) {
  return buildTransactionalEmail({
    subject: "Verify your email address | Many Worlds",
    preheader: "Confirm your email address to finish setting up your Many Worlds account.",
    eyebrow: "ACCOUNT VERIFICATION",
    title: "Verify your email address",
    introduction: "Welcome to Many Worlds. Confirm this email address to finish setting up your account and continue exploring shared story worlds.",
    actionLabel: "Verify email address",
    actionUrl: url,
    followUp: "After verification, you can sign in securely and continue from where you left off.",
    securityNotice: `This link expires in ${expiresInMinutes} minutes and can be used only once. If you did not create a Many Worlds account, you can safely ignore this email.`,
    supportEmail
  });
}
