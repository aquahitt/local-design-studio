module.exports = {
  packagerConfig: {
    name: "LocalDesignStudio",
    executableName: "LocalDesignStudio",
    appBundleId: "org.localdesignstudio.app",
    asar: { unpack: "**/{vendor/esbuild/bin/*,mcp/*.mjs}" },
    prune: false,
    ignore: (path) =>
      path !== "" &&
      !/^\/(desktop-dist(?:\/|$)|package\.json$|LICENSE$|THIRD_PARTY_NOTICES\.md$)/.test(
        path,
      ),
    osxSign: process.env.APPLE_SIGN_IDENTITY
      ? { identity: process.env.APPLE_SIGN_IDENTITY }
      : {
          identity: "-",
          identityValidation: false,
          hardenedRuntime: false,
          preAutoEntitlements: false,
          preEmbedProvisioningProfile: false,
          optionsForFile: () => ({
            entitlements: "desktop/entitlements-adhoc.plist",
            hardenedRuntime: false,
          }),
        },
    ...(process.env.APPLE_ID &&
    process.env.APPLE_APP_PASSWORD &&
    process.env.APPLE_TEAM_ID
      ? {
          osxNotarize: {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_APP_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
          },
        }
      : {}),
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "win32", "linux"],
    },
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "LocalDesignStudio",
        authors: "Local Design Studio contributors",
        description: "Local-first interface design studio",
        ...(process.env.WINDOWS_CERTIFICATE_FILE
          ? {
              certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
              certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
            }
          : {}),
      },
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          name: "local-design-studio",
          bin: "LocalDesignStudio",
          productName: "Local Design Studio",
          maintainer: "Local Design Studio contributors",
          homepage: "https://github.com/aquahitt/local-design-studio",
        },
      },
    },
  ],
};
