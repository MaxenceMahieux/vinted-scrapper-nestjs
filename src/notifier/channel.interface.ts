export interface NotificationPayload {
  searchName: string;
  title: string;
  price: number;
  currency: string;
  url: string;
  brand?: string;
  size?: string;
  photoUrl?: string;
  isDeal?: boolean;
  dealScore?: number;
}
export interface NotificationChannel {
  readonly key: string;
  isEnabled(): boolean;
  send(p: NotificationPayload): Promise<void>;
}
export const NOTIFICATION_CHANNEL = Symbol('NOTIFICATION_CHANNEL'); // multi-provider DI token (les canaux s enregistrent via { provide: NOTIFICATION_CHANNEL, useClass, multi:true })
