import { Injectable } from '@nestjs/common';
import { ExternalAuthService } from '../auth/external-auth.service';
import { PhoneDeliveryService } from '../auth/phone-delivery.service';
import { PayService } from '../commerce/pay.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class LaunchReadinessService {
  constructor(
    private readonly settings: SettingsService,
    private readonly phone: PhoneDeliveryService,
    private readonly external: ExternalAuthService,
    private readonly pay: PayService,
  ) {}

  async snapshot() {
    const [registration, phone, external, payments] = await Promise.allSettled([
      this.registration(),
      this.phone.policy(),
      this.externalState(),
      this.pay.configurationSummary(),
    ]);
    // Return facts needed by the checklist. Credentials and provider settings remain server-side.
    return {
      registration: registration.status === 'fulfilled' ? registration.value : null,
      phone: phone.status === 'fulfilled' ? {
        deliveryConfigured: phone.value.deliveryReady,
        passwordSignInEnabled: phone.value.passwordEnabled,
        registrationEnabled: phone.value.registrationEnabled,
      } : null,
      external: external.status === 'fulfilled' ? external.value : null,
      payments: payments.status === 'fulfilled' ? payments.value : null,
    };
  }

  private async registration() {
    const [open, invitation, emailVerification] = await Promise.all([
      this.settings.get<boolean>('security.registerEnabled'),
      this.settings.get<string>('security.registerInviteCode'),
      this.settings.get<boolean>('security.emailVerificationRequired'),
    ]);
    return {
      mode: !open ? 'admin' as const : invitation ? 'invite' as const : 'public' as const,
      emailVerificationRequired: Boolean(emailVerification),
    };
  }

  private async externalState() {
    const enabled = await this.settings.get<boolean>('security.externalLoginEnabled');
    if (!enabled) return {state: 'closed' as const, registrationEnabled: false};
    const policy = await this.external.policy();
    return {
      state: policy.ready ? 'configured' as const : 'missing' as const,
      registrationEnabled: policy.registrationEnabled,
    };
  }
}
