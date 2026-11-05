import { createHash } from 'node:crypto';

export const EXTENSION_PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAkTuFYoJUlLeFkf044tqMAimYImz1Pj/5HY4q+0dGDi2lTsRvYrMpUEwew0Vy6h2HHI9FVSLNnuBBhmsgmAzPiCd9MgwqEGjXSby9OZxW2vIsxcZPXntuDTBdBL3hlo0gadsm2mC8V1CEp4djAiipYRlxMsZq2AWddu2AmA2tq6ub2LAfj1uteAMU8aDi5hvk9+3M7Ls4tGL/+lU4jjdJjCg8LijoznICw7aU1CJ+anTFS7XIpaJjwgSj2QmEaM1z2z5f/CpszUg9962YfV+slpKtwltV1VT00/p+ZGsdncCuN5RHWX8/VvdhrjucKLXK7pikwYl1g/eWZc/Vu8rwFQIDAQAB';

export const DEVLOOP_EXTENSION_ID = createHash('sha256')
  .update(Buffer.from(EXTENSION_PUBLIC_KEY, 'base64'))
  .digest()
  .subarray(0, 16)
  .toString('hex')
  .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)));
