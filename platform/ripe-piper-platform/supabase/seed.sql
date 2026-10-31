-- Seed the blog CMS with the two launch articles (run once after the migrations).

insert into public.posts (slug, title, description, body_md, cover_path, cover_alt, status, published_at) values ('reactivate-old-b2b-leads', 'How to reactivate old B2B leads: a 14-day method', 'A step-by-step method to turn old B2B inquiries and unanswered quotes into sales meetings in 14 days, with sending limits, message rules and the numbers to track.', '**Short answer:** To reactivate old B2B leads, clean and verify your list, group the leads by how far each one got, and send each group one short message that gives a clear reason to reply. Follow up twice over about ten days, answer every reply within one hour, and never contact anyone who asks you to stop.

## Why old leads are worth contacting


An old lead is a person who once asked about your service. They know your company name, and you already paid to attract them. Many of these people did not say no. They became busy, delayed a budget or chose to wait. A short, relevant message months later often reaches them at a better time.


## Step 1: Export and clean the list


Export every inquiry, quote and past customer that has not heard from you in at least 90 days. Include the name, company, email address, date of last contact and any note on why the deal stalled. Then clean the list:


- Remove duplicate contacts.
- Remove anyone who unsubscribed or asked not to be contacted.
- Remove personal email addresses if you sell only to businesses.
- Verify every remaining address with an email verification service.


Aim for a bounce rate of 3% or lower. A higher bounce rate tells email providers that your list is old or careless, and more of your messages will land in spam folders.


## Step 2: Group leads by stage


A person who received a quote needs a different message from a person who only downloaded a brochure. Put each lead into one of four groups:




| Group | What happened | Reason to reply |
| --- | --- | --- |
| Inquiry only | They asked a question but never received a quote. | Offer the answer or price they asked for. |
| Quote sent | They received a quote and went quiet. | Ask whether the project is still planned and offer to update the quote. |
| Meeting held | They met your team but did not buy. | Share one relevant change, such as a new service or a shorter delivery time. |
| Past customer | They bought once and have not bought again. | Ask about their next project and offer priority scheduling. |


## Step 3: Write one message per group


Write one short message for each group. Follow four rules:


1. Keep it under 125 words. Busy people read short messages.
2. Mention the original inquiry, so the reader remembers you.
3. Ask one simple question that is easy to answer.
4. Do not add attachments or links to the first message. They make spam filters more likely to block it.



> **Example for the "Quote sent" group:**
> 
> 
> Hi Sara, in March you asked us for a quote to fit out your new office in Business Bay. Is the project still planned for this year? If it is, I can update the quote with current prices this week. — Omar, Gulf Interiors


## Step 4: Send at a safe volume


Do not send hundreds of emails on the first day. Sending too much from a new or quiet inbox is the most common reason messages end up in spam.


- Send from a separate domain, not your main company domain, so any problem does not affect your everyday email.
- Set up SPF, DKIM and DMARC records on the sending domain. Google requires these for senders to Gmail accounts.
- Start at 10 to 30 emails per inbox per day and increase slowly over several weeks.
- Keep the rate of people marking your email as spam below 0\.1%. Google says senders should never reach 0\.3%.


## Step 5: Follow up twice


Many replies come from follow\-ups, not from the first message. Instantly, an email sending platform, reports that a first follow\-up adds 40% to 50% more replies. We use this schedule:


- **Day 1:** the first message.
- **Day 4:** a short follow\-up in the same email thread.
- **Day 9:** a final message that says you will not write again unless they reply.


Stop all messages to a person as soon as they reply, unsubscribe or ask you to stop.


## Step 6: Reply within one hour


When a lead replies, answer quickly. A Harvard Business Review study of 2,241 US companies, published in 2011, found that companies that contacted a lead within one hour were nearly seven times as likely to qualify that lead as companies that waited longer. Offer two specific meeting times in your reply instead of asking when they are free.


## Step 7: Measure the results




| Measure | Target |
| --- | --- |
| Bounce rate | 3% or lower |
| Spam complaint rate | Below 0\.1% |
| Reply rate | 5% to 10% is a solid result for B2B outreach, according to Instantly''s benchmarks |
| Meetings held | Count only meetings that took place with a person who matches your ideal customer |


## Common mistakes


- Sending one generic message to every old lead.
- Sending from your main company domain and damaging its reputation.
- Continuing to email people who asked you to stop.
- Waiting a day or more to answer interested replies.

## Sources
- [Google: Email sender guidelines](https://support.google.com/a/answer/14229414)
- [MailReach: Google Workspace sending limits for cold outreach](https://mailreach.co/blog/google-workspace-email-sending-limits)
- [Instantly: Cold email reply rate benchmarks](https://instantly.ai/blog/cold-email-reply-rate-benchmarks)
- [Harvard Business Review: The Short Life of Online Sales Leads (2011)](https://hbr.org/2011/03/the-short-life-of-online-sales-leads)
', '/img/guide-reactivate.jpg', 'A notebook, pen and coffee cup on a clean white desk', 'published', '2026-10-19T00:00:00Z') on conflict (slug) do nothing;

insert into public.posts (slug, title, description, body_md, cover_path, cover_alt, status, published_at) values ('cold-email-rules-uae-india', 'Cold email rules in the UAE and India: what B2B senders must do in 2026', 'What B2B companies in the UAE and India must do before sending cold email in 2026: Gmail sender rules, the UAE PDPL, India''s DPDP Act and WhatsApp opt-in.', '**Short answer:** B2B cold email is widely used in the UAE and India, and three sets of rules shape how you can send it. Gmail''s sender rules apply to everyone. The UAE Personal Data Protection Law and India''s DPDP Act govern personal data. To stay safe, authenticate your sending domain, contact business addresses only, include a working unsubscribe option, honour removal requests within 48 hours and keep a permanent do-not-contact list.

*This guide explains the rules in plain English. It is not legal advice. Ask a qualified lawyer to review your own process.*


## Rule set 1: Gmail sender requirements


Google publishes rules for anyone who sends email to personal Gmail accounts. Most B2B buyers also use Google Workspace or similar providers, so these rules are the practical baseline for every sender.


- Your messages must pass SPF and DKIM authentication.
- Your sending domain needs a DMARC record, with a policy of at least `p=none`.
- Keep the rate of people reporting your email as spam below 0\.1%, and never let it reach 0\.3%.
- Google treats a sender as a bulk sender when it sends close to 5,000 or more messages to personal Gmail accounts in one day. Bulk senders of marketing messages must offer one\-click unsubscribe and honour requests within 48 hours.


## Rule set 2: The UAE Personal Data Protection Law


Federal Decree\-Law No. 45 of 2021, known as the PDPL, governs personal data in the UAE. A business email address that contains a person''s name is personal data.


- Consent is the main legal basis for processing personal data. The law also recognises other bases, including legitimate interest.
- As of 2026, the executive regulations that explain the law in detail have not yet been issued, so some practical questions remain open.
- Companies in the DIFC and ADGM free zones follow their own data protection laws instead of the federal law.
- Published summaries of the law list administrative fines from AED 50,000 to AED 5,000,000 per violation.


## Rule set 3: India''s DPDP Act


The Digital Personal Data Protection Act, 2023 and the DPDP Rules, 2025 come into force in three phases:




| Date | What starts |
| --- | --- |
| 13 November 2025 | The Data Protection Board and the definitions. |
| 13 November 2026 | Registration of consent managers. |
| 13 May 2027 | Most business obligations: clear notices, valid consent, security safeguards, breach reporting and the rights of individuals. |


The maximum penalty under the Act is ₹250 crore, for failing to take reasonable security safeguards. Businesses that prepare before May 2027 avoid a rushed change later.


## WhatsApp: opt\-in is required


Meta''s rules require a business to have a person''s opt\-in before it messages them on WhatsApp. The person must give their number and agree to receive messages from that named business. For this reason, use WhatsApp only to reply to people who contacted you first. From 1 October 2026 Meta charges per message, including replies sent within 24 hours of the person''s last message, so check Meta''s current WhatsApp pricing before you rely on the channel.


## Checklist before you send


1. Set up SPF, DKIM and DMARC on a separate sending domain.
2. Contact business email addresses only.
3. State who you are and why you are writing in the first two sentences.
4. Include a clear way to unsubscribe in every message.
5. Honour every removal request within 48 hours and add the address to a permanent do\-not\-contact list.
6. Keep a record of where each contact came from.
7. Send WhatsApp messages only to people who contacted you first.

## Sources
- [Google: Email sender guidelines](https://support.google.com/a/answer/14229414)
- [ConsentStack: UAE PDPL overview](https://consentstack.io/regulations/uae-pdpl)
- [ComplianceHub: India DPDP phase timeline](https://compliancehub.wiki/india-dpdp-consent-manager-november-2026-phase-two-deadline-compliance/)
- [Meta for Developers: Get opt-in for WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in)
- [Message Central: WhatsApp Business API pricing 2026](https://www.messagecentral.com/blog/whatsapp-business-api-pricing-2026)
', '/img/guide-rules.jpg', 'A laptop, glasses and a cup of coffee on a wooden desk', 'published', '2026-10-19T00:00:00Z') on conflict (slug) do nothing;
