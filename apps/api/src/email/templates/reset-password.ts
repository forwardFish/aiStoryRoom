import { buildTransactionalEmail } from "./transactional-email";

export function resetPasswordTemplate(url: string, expiresInMinutes: number, supportEmail?: string) {
  return buildTransactionalEmail({
    subject: "Reset your password | Many Worlds",
    preheader: "Use this secure, one-time link to choose a new Many Worlds password.",
    eyebrow: "ACCOUNT SECURITY",
    title: "Reset your password",
    introduction: "We received a request to reset the password for your Many Worlds account. Use the secure button below to choose a new password.",
    actionLabel: "Reset password",
    actionUrl: url,
    followUp: "After the reset is complete, use your new password the next time you sign in.",
    securityNotice: `This link expires in ${expiresInMinutes} minutes and can be used only once. If you did not request a password reset, ignore this email—your password will remain unchanged.`,
    supportEmail
  });
}
