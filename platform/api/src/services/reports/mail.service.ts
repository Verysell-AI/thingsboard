import nodemailer, { type Transporter } from 'nodemailer';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: MailAttachment[];
}

/** Outbound mail; the SMTP implementation talks to mailpit locally and a real relay in production. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(message: MailMessage): Promise<void> {
    if (message.to.length === 0) return;
    await this.transport.sendMail({
      from: this.from,
      to: message.to.join(', '),
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
  }
}

/** Keeps messages in memory (tests, CLI dry runs). */
export class RecordingMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}
