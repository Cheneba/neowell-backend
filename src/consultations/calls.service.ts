import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuthUser } from '../common/auth-user';
import { Env } from '../config/env';
import { ConsultationMedium, Role } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { clinicianDisplayName } from '../clinicians/clinician-presenter';
import { ConsultationsService } from './consultations.service';

const LINK_TTL_S = 2 * 60 * 60;

interface CallLink {
  c: string; // consultation id
  u: string; // user id
  e: number; // expiry (unix seconds)
}

/** Audio/video calls via LiveKit; v2 opens a secure call page in the phone's browser (FR-CONS-09). */
@Injectable()
export class CallsService {
  private readonly secret: string;
  private readonly baseUrl: string;
  private readonly livekit?: { url: string; key: string; secret: string };

  constructor(
    private readonly prisma: PrismaService,
    private readonly consultations: ConsultationsService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = `call:${config.get('FILE_URL_SECRET', { infer: true })}`;
    this.baseUrl = config.get('PUBLIC_BASE_URL', { infer: true }).replace(/\/$/, '');
    const url = config.get('LIVEKIT_URL', { infer: true });
    const key = config.get('LIVEKIT_API_KEY', { infer: true });
    const sec = config.get('LIVEKIT_API_SECRET', { infer: true });
    if (url && key && sec) this.livekit = { url, key, secret: sec };
  }

  get enabled() {
    return !!this.livekit;
  }

  async joinLink(user: AuthUser, consultationId: string) {
    const c = await this.consultations.findForParticipant(user, consultationId);
    if (c.medium === ConsultationMedium.CHAT)
      throw new ConflictException('This is a chat consultation');
    if (!this.consultations.canJoinCall(c)) throw new ConflictException('The call is not open yet');
    if (!this.livekit)
      throw new ServiceUnavailableException('Calls are not configured on this server');
    const exp = Math.floor(Date.now() / 1000) + LINK_TTL_S;
    const payload = Buffer.from(
      JSON.stringify({ c: c.id, u: user.id, e: exp } satisfies CallLink),
    ).toString('base64url');
    return {
      joinUrl: `${this.baseUrl}/calls/${payload}.${this.sign(payload)}`,
      expiresAt: new Date(exp * 1000),
      room: c.roomName,
    };
  }

  /** Validates a call link and returns what the call page needs. */
  async pageData(token: string) {
    const [payload, sig] = token.split('.');
    if (!payload || !sig || !this.livekit) throw new NotFoundException();
    const expected = Buffer.from(this.sign(payload));
    if (expected.length !== Buffer.from(sig).length || !timingSafeEqual(expected, Buffer.from(sig)))
      throw new NotFoundException();
    const link = JSON.parse(Buffer.from(payload, 'base64url').toString()) as CallLink;
    if (link.e < Date.now() / 1000) throw new NotFoundException('This call link has expired');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: link.u } });
    const c = await this.consultations.findForParticipant({ id: user.id, role: user.role }, link.c);
    if (!this.consultations.canJoinCall(c)) throw new ConflictException('This call is not open');
    const name =
      user.role === Role.CLINICIAN
        ? clinicianDisplayName(c.clinician)
        : [user.firstName, user.lastName?.[0] ? `${user.lastName[0]}.` : ''].join(' ').trim();
    const at = new AccessToken(this.livekit.key, this.livekit.secret, {
      identity: user.id,
      name,
      ttl: '2h',
    });
    at.addGrant({
      roomJoin: true,
      room: c.roomName ?? `nw-${c.id}`,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });
    return {
      url: this.livekit.url,
      token: await at.toJwt(),
      video: c.medium === ConsultationMedium.VIDEO,
      name,
      lang: user.locale,
    };
  }

  private sign(payload: string) {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}

/** Minimal mobile call page (LiveKit web client from jsDelivr, pinned major version). */
export function callPageHtml(d: {
  url: string;
  token: string;
  video: boolean;
  name: string;
  lang: 'en' | 'fr';
}): string {
  const t =
    d.lang === 'fr'
      ? {
          title: 'Consultation NeoWell',
          joining: 'Connexion…',
          waiting: 'En attente de l’autre participant…',
          leave: 'Quitter',
          mute: 'Micro',
          cam: 'Caméra',
          ended: 'Appel terminé. Vous pouvez fermer cette page.',
        }
      : {
          title: 'NeoWell consultation',
          joining: 'Connecting…',
          waiting: 'Waiting for the other person…',
          leave: 'Leave',
          mute: 'Mic',
          cam: 'Camera',
          ended: 'Call ended. You can close this page.',
        };
  const cfg = JSON.stringify({ url: d.url, token: d.token, video: d.video }).replace(
    /</g,
    '\\u003c',
  );
  return `<!doctype html><html lang="${d.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t.title}</title><style>
body{margin:0;font-family:system-ui,sans-serif;background:#fff;color:#1E2B3C;display:flex;flex-direction:column;min-height:100vh}
header{padding:16px;color:#2C6CB5;font-weight:800;font-size:18px}#status{padding:0 16px;color:#5E6E82}
#media{flex:1;display:grid;gap:8px;padding:16px;grid-template-columns:1fr}video{width:100%;border-radius:16px;background:#EAF3FD;max-height:45vh;object-fit:cover}
footer{display:flex;gap:12px;padding:16px}button{flex:1;min-height:56px;border-radius:999px;border:2px solid #62A6EA;background:#fff;color:#2C6CB5;font-size:17px;font-weight:700}
#leave{background:#C62828;border-color:#C62828;color:#fff}</style></head><body>
<header>♥ ${t.title}</header><div id="status">${t.joining}</div><div id="media"></div>
<footer><button id="mic">${t.mute}</button>${d.video ? `<button id="cam">${t.cam}</button>` : ''}<button id="leave">${t.leave}</button></footer>
<script src="https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.umd.min.js"></script>
<script>(async()=>{const C=${cfg};const L=window.LivekitClient;const s=document.getElementById('status');const m=document.getElementById('media');
const room=new L.Room({adaptiveStream:true,dynacast:true});
room.on(L.RoomEvent.TrackSubscribed,(track)=>{const el=track.attach();m.appendChild(el);s.textContent='';});
room.on(L.RoomEvent.ParticipantConnected,()=>{s.textContent='';});
room.on(L.RoomEvent.Disconnected,()=>{s.textContent=${JSON.stringify(t.ended)};m.innerHTML='';});
try{await room.connect(C.url,C.token);await room.localParticipant.setMicrophoneEnabled(true);
if(C.video){await room.localParticipant.setCameraEnabled(true);const p=room.localParticipant.getTrackPublication(L.Track.Source.Camera);if(p&&p.track){const el=p.track.attach();el.muted=true;m.appendChild(el);}}
s.textContent=room.remoteParticipants.size?'':${JSON.stringify(t.waiting)};}catch(e){s.textContent=String(e.message||e);}
document.getElementById('mic').onclick=()=>room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
const cam=document.getElementById('cam');if(cam)cam.onclick=()=>room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled);
document.getElementById('leave').onclick=()=>room.disconnect();})();</script></body></html>`;
}
