'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { respond } from '../lib/api';

/** The PIN lives in an httpOnly cookie scoped to this one link's path, for the session only, so it never sits in the URL or in script. */
const pinCookie = { httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production' };

export async function enterPin(token: string, form: FormData) {
  const pin = String(form.get('pin') ?? '').trim();
  if (pin) (await cookies()).set('lumo_pin', pin, { ...pinCookie, path: `/j/${token}` });
  redirect(`/j/${encodeURIComponent(token)}`);
}

export async function answer(token: string, kind: 'respond' | 'unrespond') {
  const pin = (await cookies()).get('lumo_pin')?.value;
  await respond(token, kind, pin);
  redirect(`/j/${encodeURIComponent(token)}`);
}
