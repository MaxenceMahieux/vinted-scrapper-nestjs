export interface NotificationPayload {
  searchName: string;
  title: string;
  price: number;
  currency: string;
  url: string;
  brand?: string;
  size?: string;
  /** Libellé d'état de l'article (ex. « Très bon état »). */
  condition?: string;
  /** Prix effectif acheteur (article + protection), si différent du prix. */
  totalPrice?: number;
  photoUrl?: string;
  isDeal?: boolean;
  dealScore?: number;
  /** Id de l'annonce persistée : active les boutons inline Telegram. */
  listingId?: string;
  /** Id du suivi : active le bouton « stop suivi » Telegram. */
  trackedId?: string;
  /** Ancien prix lors d'une alerte de baisse (suivi de prix). */
  previousPrice?: number;
}
export interface NotificationChannel {
  readonly key: string;
  isEnabled(): boolean;
  send(p: NotificationPayload): Promise<void>;
}
export const NOTIFICATION_CHANNEL = Symbol('NOTIFICATION_CHANNEL'); // multi-provider DI token (les canaux s enregistrent via { provide: NOTIFICATION_CHANNEL, useClass, multi:true })
