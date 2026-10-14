/* ===========================================================================
   Apple Account (Apple ID) settings.

   Sign in and out, iCloud storage and features, Family Sharing, trusted
   devices, payment and security. Signing out disables iCloud-backed features
   across the rest of the simulator, which is exactly the flow support agents
   need to rehearse.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph, appIcon, UI } = Mac;

  const Account = Mac.Account = {
    data() { return Mac.state.account; },

    render(win) {
      const account = this.data();
      if (!account.signedIn) return this.signedOutPane();

      const sub = win.state.accountSub;
      if (sub) return this.subPane(win, sub);

      const icloud = account.icloud;
      const usedPct = Math.round((icloud.usedBytes / icloud.totalBytes) * 100);

      return `<div style="display:flex;align-items:center;gap:14px;margin-bottom:20px">
          ${UI.avatar(account.name, { size: 'big' })}
          <div style="min-width:0">
            <h1 style="margin:0 0 2px;font-size:22px;letter-spacing:-.02em">${esc(account.name)}</h1>
            <p class="muted" style="margin:0 0 8px;font-size:12px">${esc(account.email)}</p>
            <button class="btn" data-command="account-sub" data-arg="Personal Information">Personal Information</button>
          </div></div>

        ${UI.group(
          `<button class="row tappable" data-command="account-sub" data-arg="iCloud">
            ${Mac.paneIcon('iCloud', 'size-28')}
            <div class="row-text"><strong>iCloud</strong>
              <p>${Mac.bytes(icloud.usedBytes)} of ${Mac.bytes(icloud.totalBytes)} used — ${icloud.plan} plan</p>
              <div class="storage-bar" style="margin-top:7px;max-width:260px">
                ${icloud.breakdown.map(entry => `<i style="width:${(entry.bytes / icloud.totalBytes) * 100}%;background:${entry.color}"></i>`).join('')}</div></div>
            <div class="row-action"><span class="badge ${usedPct > 85 ? 'warn' : 'info'}">${usedPct}% used</span>
              <span class="chevron">${glyph('chevron', { size: 13 })}</span></div></button>`,
          UI.action('Media & Purchases', 'account-sub', 'Subscriptions, purchase history and payment.', '', { arg: 'Media & Purchases' }),
          UI.action('Family Sharing', 'settings-pane', account.family.enabled
            ? `${Mac.plural(account.family.members.length, 'member')}` : 'Not set up', '', { arg: 'Family Sharing' }),
          UI.action('Sign-In & Security', 'account-sub', account.twoFactor ? 'Two-factor authentication on' : 'Two-factor authentication off', '', { arg: 'Sign-In & Security' }),
          UI.action('Payment & Shipping', 'account-sub', account.payment, '', { arg: 'Payment & Shipping' }),
        )}

        <div class="section-title">Devices</div>
        ${UI.group(...account.devices.map(device => `<button class="row tappable" data-command="account-device" data-arg="${esc(device.name)}">
            <span class="store-row-app" style="width:30px;height:30px">${appIcon(device.icon)}</span>
            <div class="row-text"><strong>${esc(device.name)}</strong><p>${esc(device.model)} — ${esc(device.os)}</p></div>
            <div class="row-action">${device.kind === 'This Mac' ? '<span class="badge ok">This Mac</span>' : ''}
              <span class="chevron">${glyph('chevron', { size: 13 })}</span></div></button>`))}

        ${UI.group(
          `<button class="row tappable" data-command="account-signout">
            <div class="row-text"><strong class="danger-text">Sign Out</strong>
              <p>Turns off iCloud features on this Mac and keeps a local copy of your data.</p></div>
            <span class="chevron">${glyph('chevron', { size: 13 })}</span></button>`,
        )}`;
    },

    signedOutPane() {
      return `${UI.header('Apple Account', 'Sign in to use iCloud, the App Store, Messages, Find My and more.')}
        <div class="group"><div class="row block" style="text-align:center;padding:26px">
          <div style="width:72px;height:72px;margin:0 auto 14px;display:grid;place-items:center;color:var(--accent)">${glyph('icloud', { size: 62 })}</div>
          <strong style="font-size:15px;display:block;margin-bottom:6px">Sign in with your Apple Account</strong>
          <p class="muted" style="margin:0 auto 16px;max-width:44ch;font-size:12px">
            iCloud Drive, Photos, Mail, Find My and Family Sharing are all disabled while you are signed out.</p>
          <button class="btn primary large" data-command="account-signin">Sign In…</button>
        </div></div>
        ${UI.group(
          UI.info('iCloud Drive', 'Off'),
          UI.info('Find My Mac', 'Off'),
          UI.info('iCloud Keychain', 'Off'),
          UI.info('App Store purchases', 'Unavailable'),
        )}
        <p class="section-note">Use the lab password “${Mac.LOGIN_PASSWORD}” to sign back in.</p>`;
    },

    /* -------------------------------------------------------------- sub-panes */

    subPane(win, name) {
      const account = this.data();
      const back = `<button class="btn" data-command="account-sub" data-arg="" style="margin-bottom:14px">
        ${glyph('back', { size: 13 })} Apple Account</button>`;

      if (name === 'iCloud') {
        const icloud = account.icloud;
        return `${back}${UI.header('iCloud', `${Mac.bytes(icloud.usedBytes)} of ${Mac.bytes(icloud.totalBytes)} used`)}
          <div class="group"><div class="row block">
            ${UI.stacked(icloud.breakdown, icloud.totalBytes)}
            <div class="row-flex" style="margin-top:12px">
              <button class="btn" data-command="account-manage-storage">Manage…</button>
              <button class="btn tinted" data-command="account-upgrade">Upgrade to 2 TB</button></div></div></div>
          <div class="section-title">Saved to iCloud</div>
          ${UI.group(
            UI.toggle('iCloud Drive', 'account.icloud.driveOn', 'Documents and Desktop folders sync to iCloud.'),
            UI.toggle('Desktop & Documents Folders', 'account.icloud.desktopDocuments'),
            UI.toggle('Photos', 'account.icloud.photosOn'),
            UI.toggle('Mail', 'account.icloud.mailOn'),
            UI.toggle('Passwords & Keychain', 'account.icloud.keychainOn'),
          )}
          <div class="section-title">Private Cloud</div>
          ${UI.group(
            UI.toggle('iCloud Private Relay', 'account.icloud.privateRelay', 'Hides the IP address from websites in Safari.'),
            UI.toggle('Hide My Email', 'account.icloud.hideEmail'),
            UI.toggle('Find My Mac', 'account.icloud.findMyMac', 'Locate, lock or erase this Mac if it goes missing.'),
          )}
          <p class="section-note">Turning off Private Relay is a common step when a customer reports that a corporate site refuses to load.</p>`;
      }

      if (name === 'Sign-In & Security') {
        return `${back}${UI.header('Sign-In & Security', esc(account.appleId))}
          ${UI.group(
            UI.info('Apple Account', account.appleId, '', '<button class="btn" data-command="account-change-email">Edit…</button>'),
            UI.info('Password', 'Changed 42 days ago', '', '<button class="btn" data-command="account-change-password">Change Password…</button>'),
            UI.info('Two-Factor Authentication', account.twoFactor ? 'On' : 'Off', '',
              `<button class="switch ${account.twoFactor ? 'on' : ''}" data-command="account-two-factor" aria-label="Two-factor authentication"></button>`),
            UI.info('Trusted Phone Number', account.trustedPhone),
          )}
          <div class="section-title">Account Recovery</div>
          ${UI.group(
            UI.action('Recovery Contact', 'account-recovery-contact', account.recoveryContact),
            UI.action('Recovery Key', 'account-recovery-key', account.recoveryKey ? 'On' : 'Off'),
            UI.action('Legacy Contact', 'generic', 'Not set up'),
          )}
          <div class="section-title">Sign in with Apple</div>
          ${UI.group(UI.info('Apps using your Apple Account', '2 apps', 'Bench Tools and Support Portal'))}
          ${!account.twoFactor ? '<p class="section-note danger-text">Two-factor authentication is off. Most iCloud features require it in a real deployment.</p>' : ''}`;
      }

      if (name === 'Media & Purchases') {
        return `${back}${UI.header('Media & Purchases', esc(account.email))}
          <div class="section-title">Subscriptions</div>
          ${UI.group(...account.subscriptions.map(subscription =>
            UI.info(subscription.name, subscription.price, `Renews ${subscription.renews}`,
              `<button class="btn" data-command="account-cancel-subscription" data-arg="${esc(subscription.name)}">Cancel</button>`)))}
          <div class="section-title">Purchases</div>
          ${UI.group(
            UI.action('Purchase History', 'generic', 'View your purchases.'),
            UI.action('Redeem Gift Card or Code', 'generic', ''),
            UI.toggle('Ask to buy for family members', 'account.family.purchaseSharing'),
          )}
          ${UI.group(UI.info('Payment method', account.payment, '',
            '<button class="btn" data-command="account-sub" data-arg="Payment & Shipping">Manage…</button>'))}`;
      }

      if (name === 'Payment & Shipping') {
        return `${back}${UI.header('Payment & Shipping')}
          ${UI.group(
            UI.info('Payment method', account.payment, 'Expires 09/28', '<span class="badge ok">Verified</span>'),
            UI.action('Add Payment Method', 'account-add-payment', ''),
          )}
          ${UI.group(
            UI.info('Billing name', account.name),
            UI.info('Billing address', '1 Bench Way, Orlando, FL 32801'),
            UI.info('Shipping address', 'Same as billing'),
          )}
          `;
      }

      if (name === 'Personal Information') {
        return `${back}${UI.header('Personal Information')}
          ${UI.group(
            UI.info('Name', account.name, '', '<button class="btn" data-command="account-rename">Edit…</button>'),
            UI.info('Date of birth', '14 March 1992'),
            UI.info('Contactable at', account.email),
            UI.info('Country or region', 'United States'),
          )}
          ${UI.group(
            UI.toggle('Share my location with family', 'account.family.locationSharing'),
            UI.action('Communication Preferences', 'generic', 'Announcements and Apple News updates.'),
            UI.action('Data & Privacy', 'generic', 'Request a copy of your data.'),
          )}`;
      }

      return `${back}${UI.empty(name, 'This detail pane is not implemented.')}`;
    },

    familyPane() {
      const family = this.data().family;
      if (!this.data().signedIn) return this.signedOutPane();
      if (!family.enabled) {
        return `${UI.header('Family Sharing', 'Share subscriptions, purchases and location with up to five people.')}
          ${UI.empty('Family Sharing is not set up', 'Set it up to share iCloud storage, subscriptions and Screen Time settings.', {
            icon: 'family',
            action: '<button class="btn primary" data-command="family-setup">Set Up Family Sharing…</button>',
          })}`;
      }

      return `${UI.header('Family Sharing', `${esc(family.organizer)} is the organiser`)}
        ${UI.group(...family.members.map(member => `<div class="row">
          ${UI.avatar(member.name, { size: 'small', initials: member.initials })}
          <div class="row-text"><strong>${esc(member.name)}</strong><p>${esc(member.role)}</p></div>
          <div class="row-action">${member.role === 'Organizer' ? '<span class="badge ok">You</span>'
            : `<button class="btn" data-command="family-remove" data-arg="${esc(member.name)}">Remove…</button>`}</div></div>`))}
        <button class="btn primary" data-command="family-add">Add Member…</button>
        <div class="section-title">Shared features</div>
        ${UI.group(
          UI.toggle('Purchase Sharing', 'account.family.purchaseSharing', 'Family members can download each other’s purchases.'),
          UI.toggle('Location Sharing', 'account.family.locationSharing'),
          UI.toggle('Screen Time for children', 'account.family.screenTimeForKids'),
        )}
        ${UI.group(
          UI.info('iCloud+ storage', `${this.data().icloud.plan} shared with the family`),
          UI.info('Apple Music', 'Individual plan — not shared', '', '<span class="badge warn">Not shared</span>'),
          UI.action('Stop Family Sharing', 'family-stop', 'Removes every member from this family.'),
        )}`;
    },

    /* ---------------------------------------------------------------- actions */

    signIn() {
      Mac.Dialog.open({
        title: 'Sign in with your Apple Account',
        icon: 'icloud',
        body: `<div class="dialog-field"><label for="aid-email">Apple Account</label>
            <input id="aid-email" value="${esc(this.data().appleId)}" autocomplete="off" spellcheck="false"></div>
          <div class="dialog-field"><label for="aid-password">Password</label>
            <input id="aid-password" type="password" autocomplete="off"></div>
          <p class="field-error" id="aid-error"></p>
          `,
        buttons: [
          { label: 'Cancel' },
          {
            label: 'Sign In',
            primary: true,
            close: false,
            action: () => {
              const email = document.getElementById('aid-email').value.trim();
              const password = document.getElementById('aid-password').value;
              const error = document.getElementById('aid-error');
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { error.textContent = 'Enter a valid Apple Account address.'; return; }
              if (password !== Mac.LOGIN_PASSWORD) { error.textContent = 'Incorrect password. The lab password is “support”.'; return; }
              const reason = Mac.Network.offlineReason();
              if (reason) {
                error.textContent = reason === 'no-dns'
                  ? 'Sign-in failed: the server address could not be resolved. Check DNS in Network settings.'
                  : reason === 'proxy'
                    ? 'Sign-in failed: the configured proxy refused the connection.'
                    : 'Sign-in requires an internet connection.';
                return;
              }
              if (this.data().twoFactor) { Mac.Dialog.close(); this.twoFactorPrompt(email); return; }
              Mac.Dialog.close();
              this.completeSignIn(email);
            },
          },
        ],
        onMount: () => setTimeout(() => document.getElementById('aid-password')?.focus(), 30),
      });
    },

    twoFactorPrompt(email) {
      Mac.Dialog.open({
        title: 'Two-Factor Authentication',
        icon: 'shield',
        body: `<p style="margin:0 0 6px;font-size:12.5px;color:var(--text-2)">
            A verification code was sent to ${esc(this.data().trustedPhone)}. Enter it to finish signing in.</p>
          <div class="dialog-field"><label for="aid-code">Verification code</label>
            <input id="aid-code" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="off"></div>
          <p class="field-error" id="aid-code-error"></p>
          `,
        buttons: [
          { label: 'Cancel' },
          {
            label: 'Verify',
            primary: true,
            close: false,
            action: () => {
              const code = document.getElementById('aid-code').value.trim();
              if (code !== '424242') {
                document.getElementById('aid-code-error').textContent = 'Incorrect verification code.';
                return;
              }
              Mac.Dialog.close();
              this.completeSignIn(email);
            },
          },
        ],
        onMount: () => setTimeout(() => document.getElementById('aid-code')?.focus(), 30),
      });
    },

    completeSignIn(email) {
      const account = this.data();
      account.signedIn = true;
      account.email = email;
      account.appleId = email;
      account.icloud.driveOn = true;
      account.icloud.photosOn = true;
      account.icloud.mailOn = true;
      account.icloud.keychainOn = true;
      account.icloud.findMyMac = true;
      Mac.save();
      Mac.sync();
      Mac.wm.refreshAll();
      Mac.Notify.show('Apple Account', `Signed in as ${email}. iCloud features are on.`, { app: 'settings' });
    },

    async signOut() {
      const keep = { value: true };
      const confirmed = await new Promise(resolve => {
        Mac.Dialog.open({
          title: 'Sign out of your Apple Account?',
          icon: 'warning',
          body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">
              iCloud Drive, Photos, Find My Mac, Messages and iCloud Keychain will be turned off on this Mac.</p>
            ${UI.check('Keep a copy of iCloud Drive files on this Mac', 'account.icloud.keepLocal')}`,
          buttons: [
            { label: 'Cancel', action: () => resolve(false) },
            { label: 'Sign Out', danger: true, action: () => resolve(true) },
          ],
        });
      });
      if (!confirmed) return;

      const account = this.data();
      account.signedIn = false;
      account.icloud.driveOn = false;
      account.icloud.photosOn = false;
      account.icloud.mailOn = false;
      account.icloud.keychainOn = false;
      account.icloud.findMyMac = false;
      account.icloud.privateRelay = false;
      Mac.save();
      Mac.sync();
      Mac.wm.refreshAll();
      Mac.Notify.show('Apple Account', 'Signed out. iCloud features are off on this Mac.', { app: 'settings' });
      void keep;
    },

    toggleTwoFactor() {
      const account = this.data();
      if (account.twoFactor) {
        Mac.Dialog.open({
          title: 'Turn off two-factor authentication?',
          icon: 'warning',
          body: '<p style="margin:0;font-size:12.5px;color:var(--text-2)">This action is unavailable for this account.</p>',
          buttons: [
            { label: 'Cancel' },
            { label: 'Turn Off', danger: true, action: () => { account.twoFactor = false; Mac.save(); Mac.wm.refresh('settings'); } },
          ],
        });
        return;
      }
      account.twoFactor = true;
      Mac.save();
      Mac.wm.refresh('settings');
      Mac.Notify.show('Apple Account', 'Two-factor authentication is on.', { app: 'settings' });
    },

    device(name) {
      const device = this.data().devices.find(candidate => candidate.name === name);
      if (!device) return;
      const isThisMac = device.kind === 'This Mac';
      Mac.Dialog.open({
        title: device.name,
        icon: { app: device.icon },
        body: UI.group(
          UI.info('Model', device.model),
          UI.info('Operating system', device.os),
          UI.info('Trusted device', device.trusted ? 'Yes' : 'No'),
          UI.info('Find My', this.data().icloud.findMyMac ? 'On' : 'Off'),
          UI.info('iCloud Backup', isThisMac ? 'Not applicable' : 'Today at 03:12'),
        ),
        buttons: [
          { label: 'Done', primary: true },
          isThisMac
            ? { label: 'Erase This Mac…', danger: true, action: () => Mac.Power.factoryReset() }
            : { label: 'Remove from Account…', danger: true, action: () => this.removeDevice(name) },
        ],
      });
    },

    async removeDevice(name) {
      const confirmed = await Mac.Dialog.confirm({
        title: `Remove “${name}” from your account?`,
        body: 'The device will need to sign in again to use iCloud.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!confirmed) return;
      const account = this.data();
      account.devices = account.devices.filter(device => device.name !== name);
      Mac.save();
      Mac.wm.refresh('settings');
      Mac.Notify.show('Apple Account', `${name} was removed.`, { app: 'settings' });
    },

    upgradeStorage() {
      Mac.Dialog.open({
        title: 'Change your iCloud+ plan',
        icon: 'icloud',
        body: `<div class="group">${[['50 GB', '$0.99'], ['200 GB', '$2.99'], ['2 TB', '$9.99'], ['6 TB', '$29.99'], ['12 TB', '$59.99']]
          .map(([plan, price]) => `<button class="row tappable" data-command="account-set-plan" data-arg="${plan}">
            <div class="row-text"><strong>${plan}</strong><p>${price} per month — shared with your family</p></div>
            ${this.data().icloud.plan === plan ? '<span class="badge ok">Current</span>' : `<span class="chevron">${glyph('chevron', { size: 13 })}</span>`}</button>`).join('')}</div>`,
        buttons: [{ label: 'Cancel' }],
      });
    },

    setPlan(plan) {
      const sizes = { '50 GB': 53687091200, '200 GB': 214748364800, '2 TB': 2199023255552, '6 TB': 6597069766656, '12 TB': 13194139533312 };
      const account = this.data();
      account.icloud.plan = plan;
      account.icloud.totalBytes = sizes[plan] || account.icloud.totalBytes;
      account.subscriptions = account.subscriptions.map(subscription =>
        subscription.name.startsWith('iCloud+') ? { ...subscription, name: `iCloud+ ${plan}` } : subscription);
      Mac.save();
      Mac.Dialog.close();
      Mac.wm.refresh('settings');
      Mac.Notify.show('Apple Account', `Your iCloud+ plan is now ${plan}.`, { app: 'settings' });
    },

    async rename() {
      const name = await Mac.Dialog.prompt({
        title: 'Change your name',
        label: 'Full name',
        value: this.data().name,
        confirmLabel: 'Save',
        icon: 'person',
      });
      if (!name) return;
      this.data().name = name;
      this.data().initials = Mac.initials(name);
      Mac.save();
      Mac.sync();
      Mac.wm.refreshAll();
    },

    async addFamilyMember() {
      const name = await Mac.Dialog.prompt({ title: 'Add a family member', label: 'Name', confirmLabel: 'Invite', icon: 'family' });
      if (!name) return;
      this.data().family.members.push({ name, role: 'Adult', initials: Mac.initials(name) });
      Mac.save();
      Mac.wm.refresh('settings');
      Mac.Notify.show('Family Sharing', `An invitation was sent to ${name}.`, { app: 'settings' });
    },

    async removeFamilyMember(name) {
      const confirmed = await Mac.Dialog.confirm({
        title: `Remove ${name} from your family?`,
        body: 'They keep their own Apple Account but lose access to shared purchases and storage.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!confirmed) return;
      const family = this.data().family;
      family.members = family.members.filter(member => member.name !== name);
      Mac.save();
      Mac.wm.refresh('settings');
    },

    async stopFamily() {
      const confirmed = await Mac.Dialog.confirm({
        title: 'Stop Family Sharing?',
        body: 'Everyone loses access to shared purchases, storage and location.',
        confirmLabel: 'Stop Family Sharing',
        danger: true,
      });
      if (!confirmed) return;
      this.data().family.enabled = false;
      Mac.save();
      Mac.wm.refresh('settings');
    },

    setupFamily() {
      this.data().family.enabled = true;
      Mac.save();
      Mac.wm.refresh('settings');
      Mac.Notify.show('Family Sharing', 'Family Sharing is set up. You are the organiser.', { app: 'settings' });
    },

    async changePassword() {
      Mac.Dialog.open({
        title: 'Change your Apple Account password',
        icon: 'lock',
        body: `<div class="dialog-field"><label for="pw-current">Current password</label><input id="pw-current" type="password" autocomplete="off"></div>
          <div class="dialog-field"><label for="pw-new">New password</label><input id="pw-new" type="password" autocomplete="off"></div>
          <div class="dialog-field"><label for="pw-verify">Verify</label><input id="pw-verify" type="password" autocomplete="off"></div>
          <p class="field-error" id="pw-error"></p>`,
        buttons: [
          { label: 'Cancel' },
          {
            label: 'Change',
            primary: true,
            close: false,
            action: () => {
              const current = document.getElementById('pw-current').value;
              const next = document.getElementById('pw-new').value;
              const verify = document.getElementById('pw-verify').value;
              const error = document.getElementById('pw-error');
              if (current !== Mac.LOGIN_PASSWORD) { error.textContent = 'The current password is incorrect.'; return; }
              if (next.length < 8) { error.textContent = 'The new password must be at least 8 characters.'; return; }
              if (next !== verify) { error.textContent = 'The passwords do not match.'; return; }
              Mac.Dialog.close();
              Mac.Notify.show('Apple Account', 'Password changed.', { app: 'settings' });
            },
          },
        ],
      });
    },
  };
}(window.Mac));
