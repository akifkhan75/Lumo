/**
 * Contact consent, proven against real Postgres and the real HTTP pipeline
 * (docs/specs/TRUSTED_CONTACTS.md). The CHECK constraints and the partial unique index
 * are hand-written in the migration, so the drift gate cannot see them; CI runs this.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConsoleLogger, INestApplication, Logger } from '@nestjs/common';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { hashToken, INVITE_TTL_MS, ContactConsentService } from '../src/trusted-contacts/contact-consent.service';

const RUN = `cc_${Date.now()}_${randomUUID().slice(0, 6)}`;
let app: INestApplication;
let prisma: PrismaClient;
let consent: ContactConsentService;
let http: ReturnType<typeof request>;

const lines: string[] = [];

async function signup(label: string) {
  const r = await request(app.getHttpServer()).post('/api/v1/auth/signup')
    .send({ name: label, email: `${RUN}_${label}@example.com`, password: 'password123' }).expect(201);
  return { token: r.body.token as string, id: r.body.user.id as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tokenOf = (path: string) => path.split('/').pop() as string;

async function userWithContact(label: string, phone = '+923001234567') {
  const u = await signup(label);
  const put = await request(app.getHttpServer()).put('/api/v1/settings').set(auth(u.token))
    .send({ trustedContacts: [{ name: 'Ayesha', phone }] }).expect(200);
  return { ...u, contactId: put.body.trustedContacts[0].id as string };
}
async function invite(u: { token: string; contactId: string }) {
  const r = await request(app.getHttpServer()).post(`/api/v1/trusted-contacts/${u.contactId}/invite`).set(auth(u.token)).expect(201);
  return { path: r.body.path as string, token: tokenOf(r.body.path) };
}
const contactRow = (id: string) => prisma.trustedContact.findUniqueOrThrow({ where: { id }, include: { consent: true } });
const statusOf = async (u: { token: string }) =>
  (await request(app.getHttpServer()).get('/api/v1/settings').set(auth(u.token))).body.trustedContacts[0].consentStatus;

beforeAll(async () => {
  prisma = new PrismaClient();
  // Capture every log line the app writes, to prove the token never reaches one.
  const spy = (m: string) => (msg: unknown, ...rest: unknown[]) => { lines.push(`${m} ${String(msg)} ${rest.map(String).join(' ')}`); };
  Logger.overrideLogger(false);
  class Capturing extends ConsoleLogger {
    log = spy('log'); error = spy('error'); warn = spy('warn'); debug = spy('debug'); verbose = spy('verbose');
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getOptionsToken()).useValue([{ name: 'short', ttl: 1000, limit: 1_000_000 }])
    .compile();
  app = moduleRef.createNestApplication({ logger: new Capturing() });
  configureApp(app);
  await app.init();
  consent = app.get(ContactConsentService);
  http = request(app.getHttpServer()) as never;
});

afterAll(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lumo.erasure = 'on'`;
    await tx.contactInvite.deleteMany({ where: { contact: { user: { email: { startsWith: RUN } } } } });
    await tx.user.deleteMany({ where: { email: { startsWith: RUN } } });
  });
  await prisma.$disconnect();
  await app.close();
});

describe('inviting', () => {
  it('stores only a hash of the token, and the token is not recoverable', async () => {
    const u = await userWithContact('hash');
    const { token } = await invite(u);
    const rows = await prisma.contactInvite.findMany({ where: { contactId: u.contactId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows[0])).not.toContain(token);
    expect(token.length).toBeGreaterThanOrEqual(43); // 256 bits, base64url
  });

  it('says Lumo sent nothing, and never claims it did', async () => {
    const u = await userWithContact('says');
    const r = await request(app.getHttpServer()).post(`/api/v1/trusted-contacts/${u.contactId}/invite`).set(auth(u.token)).expect(201);
    expect(r.body.sentByLumo).toBe(false);
  });

  it('a user cannot invite another user’s contact', async () => {
    const a = await userWithContact('owner_a');
    const b = await signup('intruder');
    await request(app.getHttpServer()).post(`/api/v1/trusted-contacts/${a.contactId}/invite`).set(auth(b.token)).expect(404);
  });

  it('requires a login', async () => {
    await request(app.getHttpServer()).post(`/api/v1/trusted-contacts/${randomUUID()}/invite`).expect(401);
  });

  it('a new invite ends the earlier one, leaving exactly one open', async () => {
    const u = await userWithContact('replace');
    const first = await invite(u);
    const second = await invite(u);
    const rows = await prisma.contactInvite.findMany({ where: { contactId: u.contactId } });
    expect(rows.filter((r) => r.endedAt === null)).toHaveLength(1);
    expect(rows.find((r) => r.tokenHash === hashToken(first.token))?.endedReason).toBe('REPLACED');
    expect((await http.get(first.path)).status).toBe(404);
    expect((await request(app.getHttpServer()).get(second.path)).status).toBe(200);
  });

  it('concurrent invites leave one open, never two', async () => {
    const u = await userWithContact('race_inv');
    await Promise.allSettled(Array.from({ length: 6 }, () =>
      request(app.getHttpServer()).post(`/api/v1/trusted-contacts/${u.contactId}/invite`).set(auth(u.token))));
    expect(await prisma.contactInvite.count({ where: { contactId: u.contactId, endedAt: null } })).toBe(1);
  });
});

describe('the contact’s page', () => {
  it('names the inviter, shows nothing else about them, and says what is not happening', async () => {
    const u = await userWithContact('Joyce');
    await request(app.getHttpServer()).put('/api/v1/settings').set(auth(u.token))
      .send({ personalInfo: { fullName: 'Joyce Mwangi', bloodType: 'O+', allergies: 'Peanuts' } }).expect(200);
    const { path } = await invite(u);
    const res = await request(app.getHttpServer()).get(path).expect(200);
    expect(res.text).toContain('Joyce Mwangi');
    expect(res.text).toContain('does not send alerts to contacts today');
    expect(res.text).not.toMatch(/O\+|Peanuts|@example\.com|\+92300/);
  });

  it('sends the headers a secret-bearing page needs', async () => {
    const u = await userWithContact('hdr');
    const { path } = await invite(u);
    const res = await request(app.getHttpServer()).get(path).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.text).not.toMatch(/<script|http:\/\/|https:\/\//);
  });

  it('unknown, expired and replaced links are indistinguishable', async () => {
    const u = await userWithContact('indist');
    const old = await invite(u);
    await invite(u); // replaces `old`
    const expired = await invite(u);
    await prisma.contactInvite.update({ where: { tokenHash: hashToken(expired.token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const bodies = [`/api/v1/contacts/invites/${'x'.repeat(43)}`, old.path, expired.path];
    const res = await Promise.all(bodies.map((p) => request(app.getHttpServer()).get(p)));
    for (const r of res) expect(r.status).toBe(404);
    expect(new Set(res.map((r) => r.text)).size).toBe(1);
  });
});

describe('agreeing', () => {
  it('records a consent for the contact, links it, and the app shows "agreed"', async () => {
    const u = await userWithContact('agree');
    expect(await statusOf(u)).toBe('not_invited');
    const { path, token } = await invite(u);
    expect(await statusOf(u)).toBe('waiting');

    const res = await request(app.getHttpServer()).post(`${path}/accept`).expect(200);
    expect(res.text).toContain('You agreed');
    expect(await statusOf(u)).toBe('agreed');

    const row = await contactRow(u.contactId);
    expect(row.consent).toMatchObject({ kind: 'contact_role', scope: 'receive_emergency_alerts', subjectId: null, grantedById: u.contactId, revokedAt: null, regionProfileId: 'UNRESOLVED', version: 'v1' });
    const inv = await prisma.contactInvite.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    expect(inv.consentId).toBe(row.consentId);
  });

  it('is single use: many concurrent accepts record exactly one consent', async () => {
    const u = await userWithContact('race_acc');
    const { path } = await invite(u);
    const before = await prisma.consentRecord.count({ where: { grantedById: u.contactId } });
    await Promise.all(Array.from({ length: 8 }, () => request(app.getHttpServer()).post(`${path}/accept`)));
    expect(await prisma.consentRecord.count({ where: { grantedById: u.contactId } })).toBe(before + 1);
  });

  it('an expired link cannot be accepted', async () => {
    const u = await userWithContact('late');
    const { path, token } = await invite(u);
    await prisma.contactInvite.update({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(Date.now() - 1) } });
    await request(app.getHttpServer()).post(`${path}/accept`).expect(404);
    expect(await prisma.consentRecord.count({ where: { grantedById: u.contactId } })).toBe(0);
    expect(await statusOf(u)).toBe('expired');
  });

  it('refuses to invite a contact who has already agreed', async () => {
    const u = await userWithContact('twice');
    const { path } = await invite(u);
    await request(app.getHttpServer()).post(`${path}/accept`).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/trusted-contacts/${u.contactId}/invite`).set(auth(u.token)).expect(409);
  });

  it('records the user’s region profile when there is one', async () => {
    const u = await userWithContact('region');
    await prisma.user.update({ where: { id: u.id }, data: { regionProfileId: 'PK' } });
    const { path } = await invite(u);
    await request(app.getHttpServer()).post(`${path}/accept`).expect(200);
    expect((await contactRow(u.contactId)).consent?.regionProfileId).toBe('PK');
  });
});

describe('withdrawing', () => {
  it('the contact withdraws with their link, immediately; the record is revoked, never deleted', async () => {
    const u = await userWithContact('withdraw');
    const { path } = await invite(u);
    await request(app.getHttpServer()).post(`${path}/accept`).expect(200);
    const consentId = (await contactRow(u.contactId)).consentId as string;

    const res = await request(app.getHttpServer()).post(`${path}/revoke`).expect(200);
    expect(res.text).toContain('no longer');
    expect(await statusOf(u)).toBe('withdrawn');
    const rec = await prisma.consentRecord.findUniqueOrThrow({ where: { id: consentId } });
    expect(rec.revokedAt).not.toBeNull();
    expect(rec.revokedReason).toBe('CONTACT_WITHDREW');
    // The same link still tells them they withdrew, and a second withdrawal is harmless.
    await request(app.getHttpServer()).post(`${path}/revoke`).expect(200);
    expect((await request(app.getHttpServer()).get(path)).text).toContain('no longer');
  });

  it('after withdrawing, the user can ask again and the contact can agree again', async () => {
    const u = await userWithContact('again');
    const first = await invite(u);
    await request(app.getHttpServer()).post(`${first.path}/accept`).expect(200);
    await request(app.getHttpServer()).post(`${first.path}/revoke`).expect(200);
    const second = await invite(u);
    await request(app.getHttpServer()).post(`${second.path}/accept`).expect(200);
    expect(await statusOf(u)).toBe('agreed');
    expect(await prisma.consentRecord.count({ where: { grantedById: u.contactId } })).toBe(2); // history kept
  });
});

describe('changing who would be reached', () => {
  async function agreed(label: string) {
    const u = await userWithContact(label);
    const inv = await invite(u);
    await request(app.getHttpServer()).post(`${inv.path}/accept`).expect(200);
    return { u, inv };
  }
  const resend = (u: { token: string }, id: string, phone: string) =>
    request(app.getHttpServer()).put('/api/v1/settings').set(auth(u.token)).send({ trustedContacts: [{ id, name: 'Ayesha', phone }] });

  it('a new number revokes consent AND ends the link, so the link cannot grant consent for the new number', async () => {
    const { u, inv } = await agreed('newnum');
    await resend(u, u.contactId, '+923009999999').then((r) => expect(r.status).toBe(200));
    expect(await statusOf(u)).toBe('details_changed');
    expect((await contactRow(u.contactId)).consent).toBeNull();
    await request(app.getHttpServer()).post(`${inv.path}/accept`).expect(404);
    await request(app.getHttpServer()).post(`${inv.path}/revoke`).expect(404);
    expect(await prisma.consentRecord.findMany({ where: { grantedById: u.contactId, revokedAt: null } })).toHaveLength(0);
  });

  it('an outstanding, unaccepted link dies with the number it was sent for', async () => {
    const u = await userWithContact('pending_change');
    const inv = await invite(u);
    await resend(u, u.contactId, '+923008888888').then((r) => expect(r.status).toBe(200));
    await request(app.getHttpServer()).post(`${inv.path}/accept`).expect(404);
    expect(await prisma.consentRecord.count({ where: { grantedById: u.contactId } })).toBe(0);
  });

  it('reformatting the same number keeps consent and the link', async () => {
    const { u, inv } = await agreed('reformat');
    await resend(u, u.contactId, '+92 300 123 4567').then((r) => expect(r.status).toBe(200));
    expect(await statusOf(u)).toBe('agreed');
    expect((await request(app.getHttpServer()).get(inv.path)).status).toBe(200);
  });

  it('removing the contact ends the link', async () => {
    const { u, inv } = await agreed('removed');
    await request(app.getHttpServer()).put('/api/v1/settings').set(auth(u.token)).send({ trustedContacts: [] }).expect(200);
    await request(app.getHttpServer()).post(`${inv.path}/revoke`).expect(404);
    expect((await prisma.contactInvite.findMany({ where: { contactId: u.contactId } })).every((i) => i.endedAt !== null)).toBe(true);
  });
});

describe('phone numbers', () => {
  it('stores E.164, and refuses a number that cannot exist', async () => {
    const u = await signup('phones');
    await request(app.getHttpServer()).put('/api/v1/settings').set(auth(u.token))
      .send({ trustedContacts: [{ name: 'X', phone: '12345' }] }).expect(400);
    const ok = await request(app.getHttpServer()).put('/api/v1/settings').set(auth(u.token))
      .send({ trustedContacts: [{ name: 'X', phone: '+92 300-1234567' }] }).expect(200);
    expect(ok.body.trustedContacts[0].phone).toBe('+923001234567');
  });

  it('never assumes a country: a local number with no region is refused', async () => {
    const u = await signup('nocountry');
    const r = await request(app.getHttpServer()).put('/api/v1/settings').set(auth(u.token))
      .send({ trustedContacts: [{ name: 'X', phone: '0300 1234567' }] }).expect(400);
    expect(JSON.stringify(r.body)).toContain('country code');
  });

  it('reads a local number in the user’s own country', async () => {
    const u = await signup('pkuser');
    await prisma.user.update({ where: { id: u.id }, data: { regionProfileId: 'PK' } });
    const r = await request(app.getHttpServer()).put('/api/v1/settings').set(auth(u.token))
      .send({ trustedContacts: [{ name: 'X', phone: '0300 1234567' }] }).expect(200);
    expect(r.body.trustedContacts[0].phone).toBe('+923001234567');
  });

  it('an old, unnormalisable number sent back unchanged does not block the save', async () => {
    const u = await signup('legacy');
    const row = await prisma.trustedContact.create({
      data: { id: randomUUID(), userId: u.id, name: 'Old', phone: 'placeholder' },
    });
    // Write a legacy loose value through the real cipher path by using the service's own encryption.
    const { PiiCipher } = await import('../src/crypto/pii-cipher');
    const cipher = app.get(PiiCipher);
    await prisma.trustedContact.update({ where: { id: row.id }, data: { phone: cipher.encrypt('555 1234', { model: 'TrustedContact', column: 'phone', rowId: row.id }) } });

    const r = await request(app.getHttpServer()).put('/api/v1/settings').set(auth(u.token))
      .send({ personalInfo: { fullName: 'Still saves' }, trustedContacts: [{ id: row.id, name: 'Old', phone: '555 1234' }] });
    expect(r.status).toBe(200);
    expect(r.body.trustedContacts[0].phone).toBe('555 1234'); // kept as stored
  });
});

describe('database constraints (the drift gate cannot see these)', () => {
  const now = new Date();
  const base = (contactId: string) => ({ contactId, tokenHash: randomUUID(), expiresAt: new Date(now.getTime() + INVITE_TTL_MS) });

  it('refuses a second open invite for one contact', async () => {
    const u = await userWithContact('uniq');
    await prisma.contactInvite.create({ data: base(u.contactId) });
    await expect(prisma.contactInvite.create({ data: base(u.contactId) })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows many ended invites for one contact', async () => {
    const u = await userWithContact('hist');
    for (let i = 0; i < 3; i++) await prisma.contactInvite.create({ data: { ...base(u.contactId), endedAt: now, endedReason: 'REPLACED' } });
    expect(await prisma.contactInvite.count({ where: { contactId: u.contactId } })).toBe(3);
  });

  it('an end needs a reason, and a reason needs an end', async () => {
    const u = await userWithContact('chk_end');
    await expect(prisma.contactInvite.create({ data: { ...base(u.contactId), endedAt: now } })).rejects.toThrow(/ended_has_reason/);
    await expect(prisma.contactInvite.create({ data: { ...base(u.contactId), endedReason: 'X' } })).rejects.toThrow(/ended_has_reason/);
  });

  it('accepted means a consent was recorded, and the reverse', async () => {
    const u = await userWithContact('chk_acc');
    await expect(prisma.contactInvite.create({ data: { ...base(u.contactId), acceptedAt: now } })).rejects.toThrow(/accepted_has_consent/);
    await expect(prisma.contactInvite.create({ data: { ...base(u.contactId), consentId: randomUUID() } })).rejects.toThrow(/accepted_has_consent/);
  });

  it('tokenHash is unique', async () => {
    const u = await userWithContact('uniq_hash');
    const h = randomUUID();
    await prisma.contactInvite.create({ data: { ...base(u.contactId), tokenHash: h, endedAt: now, endedReason: 'REPLACED' } });
    await expect(prisma.contactInvite.create({ data: { ...base(u.contactId), tokenHash: h } })).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('logging', () => {
  it('no token appears in any log line, including for a failed request', async () => {
    const u = await userWithContact('logs');
    const { path, token } = await invite(u);
    await request(app.getHttpServer()).get(path);
    await request(app.getHttpServer()).post(`${path}/accept`);
    await request(app.getHttpServer()).get(`/api/v1/contacts/invites/${'z'.repeat(43)}`);
    // A server error on a token path is where a URL gets logged: provoke one.
    const original = consent.view.bind(consent);
    (consent as any).view = async () => { throw new Error('boom'); };
    const failed = await request(app.getHttpServer()).get(path);
    (consent as any).view = original;
    expect(failed.status).toBe(500);
    expect(lines.some((l) => l.includes('/api/v1/contacts/invites/:token'))).toBe(true);
    expect(lines.filter((l) => l.includes(token))).toEqual([]);
  });
});
