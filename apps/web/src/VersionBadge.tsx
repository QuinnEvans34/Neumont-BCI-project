export default function VersionBadge() {
  const { version, branch, commit, dirty, channel } = __BUILD_INFO__;
  const details = `${branch} / ${commit}${dirty ? " / local changes" : ""}`;
  return (
    <span className="build-version" title={`${channel} build: v${version} / ${details}`}>
      <span><strong>v{version}</strong> <span className="build-channel">{channel}</span></span>
      <span className="build-details">{branch} · {commit}{dirty ? " · modified" : ""}</span>
    </span>
  );
}
