# Disable debug packages as we're packaging precompiled binaries
%global debug_package %{nil}
%global __strip /bin/true
%undefine __brp_check_rpaths

# Exclude private shared libraries from being registered as provides or requirements
%global __provides_exclude_from ^/opt/antigravity/.*\\.so.*$
%global __requires_exclude_from ^/opt/antigravity/.*\\.so.*$
%global __requires_exclude ^(libffmpeg\\.so|/usr/bin/node)


%{!?app_version:%{error:app_version is required; use build.sh}}
Name:           antigravity
Version:        %{app_version}
Release:        1%{?dist}
Summary:        Antigravity 2.0 Agent

License:        Proprietary (Google Terms of Service)
URL:            https://storage.googleapis.com/antigravity-public/antigravity-hub/index.html
ExclusiveArch:  x86_64

# Local upstream archive and verified ASAR supplied by scripts/build-rpm.sh.
Source0:        Antigravity.tar.gz
Source1:        antigravity.desktop
Source2:        antigravity.png
Source3:        app.asar

BuildRequires:  tar
BuildRequires:  gzip

%description
Antigravity 2.0 Agent (Background Agent / Hub) repackaged for Fedora.
Includes a custom application icon and synchronized window controls.
The build script refuses upstream code that does not match verified contracts.

%prep
%setup -q -n Antigravity-x64
install -m 644 %{SOURCE3} resources/app.asar

%build
# No build steps needed for repackaged binaries

%install
mkdir -p %{buildroot}/opt/%{name}
cp -a . %{buildroot}/opt/%{name}/

# Write version file
echo "%{version}" > %{buildroot}/opt/%{name}/version.txt

# Ensure executable permission
chmod +x %{buildroot}/opt/%{name}/%{name}

# Create symlink in /usr/bin
mkdir -p %{buildroot}%{_bindir}
ln -s ../../opt/%{name}/%{name} %{buildroot}%{_bindir}/%{name}

# Install desktop file
mkdir -p %{buildroot}%{_datadir}/applications
install -m 644 %{SOURCE1} %{buildroot}%{_datadir}/applications/%{name}.desktop

# Install icon
mkdir -p %{buildroot}%{_datadir}/icons/hicolor/512x512/apps
install -m 644 %{SOURCE2} %{buildroot}%{_datadir}/icons/hicolor/512x512/apps/%{name}.png

%post
/usr/bin/update-desktop-database >/dev/null 2>&1 || :
/usr/bin/gtk-update-icon-cache %{_datadir}/icons/hicolor >/dev/null 2>&1 || :

%postun
/usr/bin/update-desktop-database >/dev/null 2>&1 || :
/usr/bin/gtk-update-icon-cache %{_datadir}/icons/hicolor >/dev/null 2>&1 || :

%files
/opt/%{name}/
%{_bindir}/%{name}
%{_datadir}/applications/%{name}.desktop
%{_datadir}/icons/hicolor/512x512/apps/%{name}.png

%changelog
* Wed Nov 11 2026 Naerelyth - 2.31.2-1
- Update
