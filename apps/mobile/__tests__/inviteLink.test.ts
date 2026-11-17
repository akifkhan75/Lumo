import { inviteTokenFrom } from '../services/inviteLink';

const TOKEN = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo';

describe('inviteTokenFrom', () => {
  it.each([
    ['the whole link', `https://api.lumo.example/api/v1/contacts/invites/${TOKEN}`],
    ['the link with /accept after it', `https://api.lumo.example/api/v1/contacts/invites/${TOKEN}/accept`],
    ['a link with a query and a fragment', `http://192.168.1.5:3005/api/v1/contacts/invites/${TOKEN}?x=1#top`],
    ['the app link', `lumo://claim/${TOKEN}`],
    ['the bare token', TOKEN],
    ['with spaces around it', `  ${TOKEN}\n`],
    ['inside the whole message they were sent', `Joyce would like you to be an emergency contact on Lumo. Nothing has been sent to you by the app. To agree, open: https://x.test/api/v1/contacts/invites/${TOKEN}`],
  ])('%s', (_name, input) => {
    expect(inviteTokenFrom(input)).toBe(TOKEN);
  });

  it.each([[''], ['   '], ['hello'], ['https://x.test/'], ['https://x.test/api/v1/contacts/invites/'], ['https://x.test/api/v1/contacts/invites/short'], [`https://x.test/other/${TOKEN}`], ['lumo://claim/'], ['../../etc/passwd'], [`${TOKEN}!!`]])('refuses %j, so nothing malformed is sent', (input) => {
    expect(inviteTokenFrom(input)).toBeNull();
  });
});
