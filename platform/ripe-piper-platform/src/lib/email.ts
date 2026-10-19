/** Plain, clear transactional emails. Every email says what happened and what to do next. */
import { gst } from "./sheets";

const sign = "\n\nRipe Piper\nhello@ripepiper.com";

export const emails = {
  bookingConfirmed: (name: string, startIso: string, meetUrl: string) => ({
    subject: `Your call with Ripe Piper is booked for ${gst(startIso)} GST`,
    text: `Hi ${name},\n\nYour 15-minute call with Ripe Piper is booked for ${gst(startIso)} Gulf Standard Time.\n\nJoin with Google Meet: ${meetUrl}\n\n` +
      `Please bring three things: a description of your ideal customer, a rough count of your past leads, and the outreach tools you use today.\n\n` +
      `To change the time, reply to this email.${sign}`,
  }),
  reminder: (name: string, startIso: string, meetUrl: string, which: "24h" | "1h") => ({
    subject: which === "24h" ? `Reminder: your Ripe Piper call is tomorrow at ${gst(startIso).slice(11)} GST` : `Your Ripe Piper call starts in one hour`,
    text: `Hi ${name},\n\nThis is a reminder that your call with Ripe Piper starts ${which === "24h" ? "tomorrow" : "in one hour"}, at ${gst(startIso)} GST.\n\n` +
      `Join with Google Meet: ${meetUrl}\n\nIf you can no longer attend, please reply to this email so we can offer you another time.${sign}`,
  }),
  calculatorBreakdown: (name: string) => ({
    subject: "Your dormant lead revenue breakdown",
    text: `Hi ${name},\n\nThank you for using the Ripe Piper calculator. Your one-page breakdown will follow within one business day.\n\n` +
      `To stop receiving these emails, reply with "unsubscribe".${sign}`,
  }),
  newsletterConfirm: (url: string) => ({
    subject: "Please confirm your Ripe Piper newsletter subscription",
    text: `Please confirm that you want to receive the Ripe Piper newsletter, one email each month.\n\nConfirm here: ${url}\n\nIf you did not sign up, ignore this email and you will not be added.${sign}`,
  }),
  preProposal: (name: string, url: string) => ({
    subject: "Your Ripe Piper pre-proposal is ready",
    text: `Hi ${name},\n\nThank you for the call. Your pre-proposal is ready to review: ${url}\n\n` +
      `It describes the work, the fixed-scope price and the 10% advance needed to start. If you approve it, you can pay the advance on the same page.${sign}`,
  }),
  advanceReceived: (name: string, amount: string, portalUrl: string) => ({
    subject: "Payment received: your Ripe Piper project has started",
    text: `Hi ${name},\n\nWe have received your advance payment of ${amount}. Thank you.\n\n` +
      `Your full proposal will arrive within one business day. Your client dashboard is ready at ${portalUrl}. Sign in with this email address.\n\n` +
      `Any customisations we discussed will be quoted separately once the proposal is confirmed.${sign}`,
  }),
  quote: (name: string, url: string) => ({
    subject: "Your Ripe Piper quotation for customisations",
    text: `Hi ${name},\n\nYour quotation for the customisations we agreed is ready to review: ${url}${sign}`,
  }),
  adminAlert: (what: string, detail: string) => ({ subject: `[Ripe Piper] ${what}`, text: detail }),
};
