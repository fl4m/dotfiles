# Fedora 44 KDE Workstation Dotfiles

End-to-end provisioning for a Fedora 44 KDE workstation. Everything is driven
by [chezmoi](https://chezmoi.io): package installs, dnf repos, third-party
tools, KeePassXC secret import, dotfiles, and KDE settings.

## Usage

On a fresh Fedora 44 KDE install:

```bash
sudo dnf install -y chezmoi
chezmoi init --apply fl4m
```

`chezmoi init --apply fl4m` resolves to `github.com/fl4m/dotfiles` and runs
everything in one go. chezmoi's built-in git clones the repo on first run
(no system `git` needed for bootstrap); `git` and `git-lfs` are then installed
via the package list before any script needs them.

That's it. chezmoi will:

1. Add Vivaldi, VS Code, and Microsoft Defender dnf repos
   (`run_onchange_before_10-repos.sh.tmpl`)
2. Upgrade the system and install all dnf packages, dnf groups, and flatpaks
   listed in `.chezmoidata/packages.yaml` (`run_onchange_before_20-packages.sh.tmpl`)
3. Enable libvirtd, set zsh as login shell, install zinit,
   `chezmoi_modify_manager`, Flux, opencode, JetBrains Toolbox
   (`run_once_before_30-system.sh.tmpl`)
4. Prompt once for the KeePassXC DB password and import all GPG keys (from
   the `GPG Keys` group), all OpenVPN connections (from the `VPN` group), and
   the kubeconfig (from the `Kubeconfig` entry)
   (`run_once_before_40-keepass.sh.tmpl`)
5. Lay down all dotfiles (`dot_*`, `private_dot_*`)
 6. Reload running KDE components so the newly written config (virtual desktops,
    window rules, shortcuts) is picked up without a re-login
    (`run_once_after_kde-settings.sh`)

## Manual pre-install steps

### pCloud (KeePass DB sync)

The KeePass database is synced via pCloud, so this must be set up first.

1. Download the AppImage from <https://www.pcloud.com/download-free-online-cloud-file-storage.html>
2. Place it at `~/.local/bin/pcloud` and make it executable
3. Launch it, log in
4. Configure sync of your KeePass folder → `~/keepass`
5. Wait for the `.kdbx` file to be present

### Personal values

On first `chezmoi init`, you'll be prompted for ~3 values (git name, git email,
KeePass DB filename). The template defaults are generic placeholders — supply
your own at the prompt. Values persist in chezmoi's state DB so re-runs don't
re-prompt.

GPG keys and OpenVPN connections are both imported from KeePassXC by
**group convention**, so there are no per-secret prompts:

- All key attachments under the `GPG Keys` group are imported, and every
  imported secret key is trusted ultimately. git signs commits via the key
  matching your email (`user.signingkey` = your git email), so no fingerprint
  is ever hardcoded.
- Every entry under the `VPN` group that has a `.ovpn` attachment becomes a
  NetworkManager connection named after the entry's title, with the username
  taken from the entry and the password left to KWallet (`password-flags=1`).
  Each connection is set to `ipv4.never-default`/`ipv6.never-default yes` so it
  is split-tunnel: the server-pushed subnet routes are used, but the VPN does
  not become the default route for all traffic.
- The `Kubeconfig` entry's attachment is exported to `~/.kube/config` (mode
  600) if that file doesn't already exist. The kubeconfig uses exec-auth
  (`aws eks get-token` / `kubelogin`), so it holds no static secrets, but it's
  kept in KeePass to avoid publishing infra identifiers in this public repo.

AWS credentials are not managed here — run `aws configure` / `aws sso login`
after setup; the AWS CLI writes `~/.aws/credentials` itself.

For non-interactive bootstrap:

```bash
chezmoi init --apply fl4m \
  --promptString git.name="Your Name" \
  --promptString git.email="you@example.com" \
  --promptString keepass.database="yourdb.kdbx" \
  ...
```

## Package list

Edit `.chezmoidata/packages.yaml` and re-run `chezmoi apply`. The packages
script re-runs automatically when the list changes (chezmoi hashes its
rendered output).

## INI files (chezmoi_modify_manager)

Several config files mix durable settings with machine-specific state (and, for
KeePassXC, secrets) in a single INI file. These are managed with
[`chezmoi_modify_manager`](https://github.com/VorpalBlade/chezmoi_modify_manager)
rather than as plain files. For each, the source of truth is a `*.src.ini`
(ignored from deployment via `**/*.src.ini` in `.chezmoiignore`) and the merge
directives live in a sibling `modify_*` script. The directives `ignore` volatile
or sensitive entries so they are taken from the live system on `chezmoi apply`
and never committed.

Managed files:

- `~/.config/keepassxc/keepassxc.ini` — `ignore`s `[KeeShare] Active/Foreign/Own`
  (the KeeShare keypair; `Own` holds the **private** key, must never reach this
  public repo), `[General] ConfigVersion` (app-managed), and
  `[General] Last*` / `[GUI] *Geometry`/`*State` (machine-specific state/paths).
- `~/.config/kwinrc` — `set`s the three virtual-desktop `Id_N` from the pinned
  UUIDs in `.chezmoidata/kde.yaml` (so `kwinrulesrc` rules bind correctly), and
  `ignore`s the `[Tiling]*` sections (live desktop/screen UUIDs) and
  `[Xwayland] Scale` (monitor-specific).
- `~/.config/kdeglobals` — tracks only the browser/accent toggles and file-dialog
  prefs; the color scheme and Look-and-Feel theme are deliberately **not** managed
  (`ignore`d) and left to the live system.
- `~/.config/dolphinrc` — `ignore`s `[General] Version`/`ViewPropsTimestamp`.
- `~/.config/kglobalshortcutsrc` — global shortcuts are almost all KDE defaults,
  so everything is `ignore`d (left to the live system) and only the deliberate
  customisations are enforced via `set`: `Meta+Tab` drives the `lastuseddesktop`
  KWin script (most-recently-used desktop switching, see below), so the stock
  `Switch to Next Desktop` is unbound; plus the `_launch` bindings for the Konsole
  tmux (`Meta+Return`) and Vivaldi private-window (`Ctrl+Alt+P`) command-shortcuts.

The `chezmoi_modify_manager` binary is installed into `~/.local/bin` by
`run_once_before_30-system.sh.tmpl` (a `before_` script), so it exists before
the `modify_` script runs during the first apply. `~/.local/bin` is on `PATH`
in both bash (`~/.bashrc`, used during bootstrap) and zsh (`dot_zshrc`), so the
script's `#!/usr/bin/env chezmoi_modify_manager` shebang resolves it. Bump
`CMM_VERSION` there to upgrade.

## Manual post-install steps

### KeePassXC

- Open KeePassXC, unlock your database
- Tools > Settings > Secret Service: assign database/group to expose

### Microsoft Defender for Endpoint

The `mdatp` package is installed from the `microsoft-prod` repo, but the agent
must be **onboarded** to the company tenant before it does anything. The
onboarding package is org-specific company property and is deliberately kept out
of both this repo and the personal KeePass database — onboard manually:

> Note: Microsoft lags new Fedora releases, so the `microsoft-prod` repo is
> auto-pinned to the newest `fedora/N/prod` that actually ships `mdatp`
> (`run_onchange_before_10-repos.sh.tmpl`), and `mdatp` is installed in a
> non-fatal step so a repo lag never aborts base provisioning. If you see the
> "mdatp not installed" warning, install it manually once the repo catches up.

1. Obtain the onboarding package from a Defender admin (Microsoft 365 Defender
   portal > Settings > Endpoints > Onboarding > OS: Linux Server).
2. Unpack it and run:
   ```bash
   sudo python3 MicrosoftDefenderATPOnboardingLinuxServer.py
   ```
3. Verify: `mdatp health --field org_id` (tenant id) and
   `mdatp health --field healthy` (`true`).

When switching machines, update the device serial in Confluence (Linux Asset
Inventory page) and obtain the enrollment package from that same page.

### Fingerprints

- `fprintd-enroll` or System Settings > Users

### KDE Connect

- Install KDE Connect on your phone and pair via the desktop applet

### PWAs

Install each as an app via Vivaldi (right-click tab > Install as App):

- Microsoft Teams: <https://teams.microsoft.com>
- WhatsApp: <https://web.whatsapp.com>
- Outlook: <https://outlook.office.com>

These are not managed by chezmoi: Vivaldi generates each app's `.desktop`
launcher (in `~/.local/share/applications/`) with an install-time app id and a
generated icon. **Autostart is a per-PWA toggle**, not automatic — open each
installed PWA, go to its menu > Settings (or the app's "Run on OS login" /
"Start automatically" option), and enable it. Vivaldi then writes a matching
`~/.config/autostart/vivaldi-<id>-Profile_1.desktop`. Enable it once per PWA you
want at login.

### Konsole tmux shortcut

Meta+Return launches a Konsole tmux session. Plasma 6 removed khotkeys, so this
is a "command shortcut": `dot_local/share/applications/konsole-tmux.desktop`
(carrying `X-KDE-GlobalAccel-CommandShortcut=true`) plus a `_launch` binding in
`kglobalshortcutsrc`. kwin_wayland owns `org.kde.kglobalaccel` and only loads
shortcuts at session start, so **the shortcut activates after the next log
out / log in.**

### Vivaldi private window shortcut

Ctrl+Alt+P opens a new Vivaldi private window. Same command-shortcut mechanism as
above: `dot_local/share/applications/vivaldi-private.desktop` runs Vivaldi's stock
`--incognito` action plus a `_launch` binding in `kglobalshortcutsrc`, so **it
also activates after the next log out / log in.**

### Last used desktop (Meta+Tab)

`Meta+Tab` switches to the most-recently-used virtual desktop instead of the next
one in order. A single press flips to the last-used desktop; rapid repeated
presses cycle through all desktops in most-recently-used order (like Alt+Tab does
for windows), wrapping around. Pausing, or switching by any other means (pager,
clicking a window), "settles" the order so the next press starts fresh.

It is a small KWin script at `dot_local/share/kwin/scripts/lastuseddesktop/`,
enabled via `[Plugins] lastuseddesktopEnabled=true` in `kwinrc`. The KWin
scripting engine has no timer, so a cycling "burst" is detected purely from the
elapsed time between presses (the `BURST_MS` constant, 800 ms, in `main.js`).
Like the Konsole shortcut above, `kglobalaccel` only loads bindings at session
start, so **Meta+Tab activates after the next log out / log in.**
