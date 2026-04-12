{pkgs}: {
  deps = [
    pkgs.chromium
    pkgs.libGL
    pkgs.libdrm
    pkgs.mesa
    pkgs.cups
    pkgs.dbus
    pkgs.expat
    pkgs.libxkbcommon
    pkgs.xorg.libXrandr
    pkgs.xorg.libXfixes
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.xorg.libX11
    pkgs.at-spi2-atk
    pkgs.atk
    pkgs.nspr
    pkgs.nss
    pkgs.glib
  ];
}
