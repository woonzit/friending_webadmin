"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { MemberAgePolicyRows } from "@/components/MemberAgePolicyRows";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import UserProfileDataEditor from "@/components/UserProfileDataEditor";
import UserAlbumsPanel from "@/components/UserAlbumsPanel";
import UserModerationPanel from "@/components/UserModerationPanel";
import UserMembershipPanel from "@/components/UserMembershipPanel";
import UserContentEditor from "@/components/UserContentEditor";
import ProductPopupPanel from "@/components/ProductPopupPanel";
import OutboundMessagingPanel from "@/components/OutboundMessagingPanel";
import VerificationUserPanel from "@/components/VerificationUserPanel";
import AdminGrantedVerificationPanel from "@/components/AdminGrantedVerificationPanel";
import AudienceVisibilityUserPanel from "@/components/AudienceVisibilityUserPanel";
import { adminCall } from "@/lib/adminClient";
import { ADMIN_GRANTED_VERIFICATION_CONTRACT_READY } from "@/lib/contractReadiness";
import { formatDate } from "@/lib/format";
import {
  identityOptionGroups,
  userProfileFields,
  type IdentityOptionGroup,
  type UserProfileFields,
} from "@/lib/profileFields";
import { userDetail, type UserDetail, type UserDetailLocation } from "@/lib/userDetail";

function locationLabel(location: UserDetailLocation | null): string {
  if (!location) return "—";
  return [
    location.city,
    location.region,
    location.country || location.country_code,
    location.location_name,
  ].filter(Boolean).join(", ") || "—";
}

export default function UserDetailPage() {
  const t = useTranslations("userDetail");
  const common = useTranslations("common");
  const locale = useLocale();
  const params = useParams<{ uid: string }>();
  const uid = useMemo(() => Number(params.uid), [params.uid]);
  const [data, setData] = useState<UserDetail | null>(null);
  const [profileFields, setProfileFields] = useState<UserProfileFields | null>(null);
  const [identityGroups, setIdentityGroups] = useState<IdentityOptionGroup[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "not-found">("loading");

  const load = useCallback(async () => {
    if (!Number.isInteger(uid) || uid <= 0) {
      setState("not-found");
      return;
    }
    // Keep an already-rendered member page mounted while a mutation refreshes
    // it, so the T-759 receipt remains visible beside the authoritative state.
    setState((current) => current === "ready" ? current : "loading");
    const [response, profileResponse] = await Promise.all([
      adminCall("user_detail", { uid }),
      adminCall("user_profile_fields", { uid, lang: locale }),
    ]);
    if (response?.error === "user-not-found" || profileResponse?.error === "user-not-found") {
      setState("not-found");
      return;
    }
    const parsedProfileFields = userProfileFields(profileResponse?.data);
    const parsedIdentityGroups = identityOptionGroups(profileResponse?.identity_options);
    // Project rather than cast: the response carries fields this page never renders, including the
    // member's login and home coordinates. See lib/userDetail.ts.
    const parsedDetail = response?.success
      ? userDetail(response, true, true)
      : null;
    if (!parsedDetail || !profileResponse?.success || !parsedProfileFields || !parsedIdentityGroups) {
      setState("error");
      return;
    }
    setData(parsedDetail);
    setProfileFields(parsedProfileFields);
    setIdentityGroups(parsedIdentityGroups);
    setState("ready");
  }, [locale, uid]);

  useEffect(() => { void load(); }, [load]);

  if (state === "loading") return <LoadingPanel />;
  if (state === "not-found") return <ErrorPanel message={t("notFound")} retry={load} />;
  if (state === "error" || !data || !profileFields) return <ErrorPanel message={t("loadError")} retry={load} />;

  const profile = data.profile;
  const detailSections: Array<{
    title: string;
    rows: Array<[string, React.ReactNode]>;
    extra?: React.ReactNode;
  }> = [
    {
      title: t("identity"),
      rows: [
        [t("uid"), profile.uid],
        [t("displayName"), profile.display_name || "—"],
        [t("username"), profile.user_name || "—"],
        [t("codename"), profile.codename || "—"],
        [t("birthday"), [profile.age || "", profile.birthyear || ""].filter(Boolean).join(" / ") || "—"],
        [t("generation"), profile.generation || "—"],
      ],
    },
    {
      title: t("contact"),
      rows: [
        [t("emailVerified"), profile.email_is_real ? profile.email || "—" : "—"],
        [t("phone"), profile.phone_e164 || "—"],
        [t("apple"), profile.has_apple_id ? common("yes") : common("no")],
        [common("createdAt"), formatDate(profile.created, locale, true)],
        [t("lastSeen"), formatDate(profile.last_seen, locale, true)],
      ],
    },
    {
      title: t("location"),
      rows: [
        [t("currentLocation"), locationLabel(profile.last_location)],
        [t("hometown"), locationLabel(profile.hometown)],
      ],
    },
    {
      title: t("profile"),
      rows: [
        [t("headline"), profile.headline || "—"],
        [t("about"), profile.about_me || "—"],
      ],
      // D-122 / T-759. The row stays diagnostic; its one control invokes the
      // dedicated receipted Core action and then reloads this authoritative page.
      extra: <MemberAgePolicyRows profile={profile} uid={uid} onReset={load} />,
    },
  ];
  const tags = data.tags;

  return (
    <>
      <Link className="back-link" href="/users">← {t("back")}</Link>
      <PageHeader eyebrow={t("eyebrow")} title={profile.display_name || `#${profile.uid}`} subtitle={t("subtitle")} />
      <section className="profile-hero">
        {profile.avatar_thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="profile-avatar" src={profile.avatar_thumb} width="92" height="92" alt="" />
        ) : (
          <span className="profile-avatar user-thumb-placeholder">{(profile.display_name || "?").slice(0, 1)}</span>
        )}
        <div>
          <h1>{profile.display_name || `#${profile.uid}`}</h1>
          <p>{profile.user_name ? `@${profile.user_name}` : profile.codename || `UID ${profile.uid}`}</p>
        </div>
      </section>
      {/* Pictures first: editing, deleting, re-cropping and choosing the
          main photo are the most-used operator actions on this page. */}
      <UserAlbumsPanel uid={uid} />
      <UserMembershipPanel uid={uid} initial={data.membership} />
      <UserModerationPanel uid={uid} />
      <VerificationUserPanel uid={uid} access={data.verification_access} />
      {ADMIN_GRANTED_VERIFICATION_CONTRACT_READY ? <AdminGrantedVerificationPanel key={`admin-granted-verification-${uid}`} uid={uid} /> : null}
      {/* The canonical identity surface of this page: gender, detailed gender
          and audience live on the audience-visibility record, and the editor
          inside this panel is the only console write for them (T-653). The
          detailed-gender options are Core's own served catalogue, so the panel
          never pins that vocabulary itself. */}
      <AudienceVisibilityUserPanel uid={uid} onIdentitySaved={load} />
      <ProductPopupPanel key={`product-popup-${uid}`} uid={uid} />
      <OutboundMessagingPanel uid={uid} displayName={profile.display_name} codename={profile.codename} />
      <UserContentEditor
        key={profile.uid}
        uid={uid}
        initialHeadline={profile.headline}
        initialAbout={profile.about_me}
      />
      <UserProfileDataEditor
        uid={uid}
        data={profileFields}
        identityGroups={identityGroups}
        onChange={setProfileFields}
      />
      <div className="section-grid">
        {detailSections.map((section) => (
          <section className="panel" key={section.title}>
            <div className="panel-header"><h2>{section.title}</h2></div>
            <div className="panel-body">
              <dl className="detail-list">
                {section.rows.map(([label, value]) => (
                  <div className="detail-row" key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
                {section.extra}
              </dl>
            </div>
          </section>
        ))}
        {data.push_channels ? (
          <section className="panel push-channels-panel">
            <div className="panel-header"><h2>{t("pushChannels.title")}</h2></div>
            <div className="panel-body">
              <p className="page-subtitle">{t("pushChannels.copy")}</p>
              <dl className="detail-list push-channel-list">
                {([
                  [t("pushChannels.fcm"), data.push_channels.fcm_token_present],
                  [t("pushChannels.onesignal"), data.push_channels.onesignal_id_present],
                ] as Array<[string, boolean]>).map(([label, present]) => (
                  <div className="detail-row" key={label}>
                    <dt>{label}</dt>
                    <dd>
                      <span className={`status-badge ${present ? "status-active" : "status-inactive"}`}>
                        {present ? t("pushChannels.present") : t("pushChannels.notPresent")}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="page-subtitle push-channel-note">{t("pushChannels.separate")}</p>
            </div>
          </section>
        ) : null}
        <section className="panel">
          <div className="panel-header"><h2>{t("gallery")}</h2></div>
          <div className="panel-body">
            {data.images.length === 0 ? <p className="page-subtitle">{t("noImages")}</p> : (
              <div className="gallery-grid">
                {data.images.map((image) => (
                  <figure className="gallery-item" key={image.image_id}>
                    <a href={image.full || image.thumb} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.thumb || image.full} alt="" loading="lazy" />
                    </a>
                    <figcaption>
                      <span className={`status-badge status-${image.mod_status || "accepted"}`}>
                        {image.mod_status === "pending"
                          ? t("imageStatusPending")
                          : image.mod_status === "denied"
                            ? t("imageStatusRejected")
                            : t("imageStatusActive")}
                      </span>
                      {image.mod_status === "pending" ? (
                        <Link href="/photo-moderation">{t("openModeration")}</Link>
                      ) : null}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><h2>{t("interests")}</h2></div>
          <div className="panel-body">
            {tags.length === 0 ? <p className="page-subtitle">{t("noTags")}</p> : (
              <div className="tag-list">{tags.map((tag, index) => <span className="tag" key={`${tag}-${index}`}>{tag}</span>)}</div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
