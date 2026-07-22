/**
 * - Production (Play / EAS production): remove expo-dev-client from native plugins.
 * - Ensure expo-localization config plugin is present (required for Android per-app
 *   locale on SDK 54; cannot be auto-injected when using dynamic config).
 */
module.exports = ({ config }) => {
  const stripDevClient = process.env.EAS_BUILD_PROFILE === "production";
  let plugins = [...(config.plugins ?? [])].filter((entry) => {
    const name = Array.isArray(entry) ? entry[0] : entry;
    return !(stripDevClient && name === "expo-dev-client");
  });
  const hasLocalization = plugins.some((e) => (Array.isArray(e) ? e[0] : e) === "expo-localization");
  if (!hasLocalization) {
    plugins = [...plugins, "expo-localization"];
  }
  const hasBuildProperties = plugins.some(
    (e) => (Array.isArray(e) ? e[0] : e) === "expo-build-properties",
  );
  if (!hasBuildProperties) {
    plugins = [
      ...plugins,
      [
        "expo-build-properties",
        {
          android: {
            enableMinifyInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
          },
        },
      ],
    ];
  }
  return {
    ...config,
    plugins,
    autolinking: stripDevClient
      ? {
          ...(config.autolinking ?? {}),
          exclude: [...new Set([...(config.autolinking?.exclude ?? []), "expo-dev-client"])],
        }
      : config.autolinking,
  };
};
