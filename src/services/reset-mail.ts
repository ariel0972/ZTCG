import { AppError } from "../lib/errors";
import nodemailer from "nodemailer";
export function resetMailSettings() {
  const key = process.env.RESEND_API_KEY,
    from = process.env.RESET_EMAIL_FROM;
  const smtpUser = process.env.SMTP_USER,
    smtpPass = process.env.SMTP_PASS;
  let origin: URL;
  try {
    origin = new URL(process.env.PUBLIC_APP_URL || "");
  } catch {
    throw new AppError(503, "Recuperação de senha ainda não configurada.");
  }
  if (
    (!key && !(smtpUser && smtpPass)) ||
    (!from && !smtpUser) ||
    (origin.protocol !== "https:" &&
      origin.hostname !== "127.0.0.1" &&
      origin.hostname !== "localhost")
  )
    throw new AppError(503, "Recuperação de senha ainda não configurada.");
  return {
    key,
    from: from || smtpUser,
    smtpUser,
    smtpPass,
    origin: origin.origin,
  };
}
export async function sendResetMail(email: string, token: string) {
  const { key, from, origin, smtpUser, smtpPass } = resetMailSettings();
  const link = `${origin}/HTML/reset-password.html#token=${token}`;
  const text = `Use este link para redefinir sua senha: ${link}\nO link expira em 30 minutos e só pode ser usado uma vez. Se você não pediu, ignore esta mensagem.`;
  if (smtpUser && smtpPass) {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      requireTLS: true,
      auth: { user: smtpUser, pass: smtpPass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      await transport.sendMail({
        from,
        to: email,
        subject: "Redefinir senha · Zacornia",
        text,
      });
    } finally {
      transport.close();
    }
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Redefinir senha · Zacornia",
      text,
    }),
  });
  if (!response.ok) throw new Error("RESET_EMAIL_FAILED");
}
