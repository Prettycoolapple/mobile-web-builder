import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import * as Localization from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type Locale = "en" | "zh";

const STORAGE_KEY = "@devfeasible/locale_override";

function detectDeviceLocale(): Locale {
  try {
    const locales = Localization.getLocales();
    const primary = locales?.[0];
    const tag = (primary?.languageTag ?? primary?.languageCode ?? "en").toLowerCase();
    if (tag.startsWith("zh")) return "zh";
  } catch {}
  return "en";
}

type Catalog = Record<string, string>;

const en: Catalog = {
  // Tabs
  "tab.search": "Search",
  "tab.messages": "Messages",
  "tab.history": "History",
  "tab.account": "Account",

  // Welcome
  "welcome.eyebrow": "NEW ZEALAND · RESIDENTIAL",
  "welcome.headline_a": "Smarter property",
  "welcome.headline_b": "decisions.",
  "welcome.subhead": "Residential property development intelligence.",
  "welcome.cta_primary": "Get started",
  "welcome.cta_secondary": "I already have an account",

  // Login
  "login.tagline": "Residential property development intelligence",
  "login.heading": "Welcome back",
  "login.subheading": "Sign in to your account to continue",
  "login.email": "Email",
  "login.email_ph": "you@example.com",
  "login.password": "Password",
  "login.password_ph": "Enter your password",
  "login.submit": "Sign in",
  "login.no_account": "Don't have an account?",
  "login.sign_up": "Sign up",
  "login.error_required": "Please enter your email and password.",
  "login.error_failed": "Login failed. Please try again.",

  // Search / chat input
  "search.placeholder": "Ask anything about NZ property…",
  "search.suggestion_1": "What's on the market in Grey Lynn?",
  "search.suggestion_2": "Find development sites under $2M",
  "search.suggestion_3": "Analyse 42 Arney Road, Remuera",
  "search.thinking": "Thinking…",
  "search.searching": "Searching properties…",
  "search.analysing": "Analysing property…",
  "search.send": "Send",
  "search.welcome_title": "How can I help?",
  "search.welcome_subtitle": "Ask about a property, search a suburb, or pick a starter below.",
  "search.format_error": "I had trouble formatting that response. Could you try rephrasing your question?",

  // History
  "history.title": "History",
  "history.new": "New Search",
  "history.empty_title": "No analyses yet",
  "history.empty_text": "Your property analyses will appear here. Tap any to reopen and continue the conversation.",
  "history.empty_btn": "Start analysing",
  "history.hint": "Tap to reopen · Long-press to delete",
  "history.delete_title": "Delete report",
  "history.delete_msg": "Remove this analysis from your history?",
  "history.cancel": "Cancel",
  "history.delete": "Delete",
  "history.error_load": "Could not load this report. Please try again.",
  "history.error_delete": "Could not delete this report. Please try again.",
  "history.today": "Today",
  "history.yesterday": "Yesterday",
  "history.days_ago": "{n} days ago",

  // Profile
  "profile.account": "Account",
  "profile.your_details": "Your details",
  "profile.change_photo": "Change photo",
  "profile.uploading": "Uploading…",
  "profile.first_name": "First name",
  "profile.last_name": "Last name",
  "profile.language": "Language",
  "profile.app_language": "App language",
  "profile.app_language_hint": "Choose the language used across the app and AI replies.",
  "profile.cancel": "Cancel",
  "profile.save": "Save",
  "profile.name": "Name",
  "profile.discipline": "Discipline",
  "profile.edit_details": "Edit details",
  "profile.current_plan": "Current plan",
  "profile.standard": "Standard",
  "profile.free_tier": "Free tier",
  "profile.free": "Free",
  "profile.reports_used": "Reports used this month",
  "profile.limit_reached_standard": "Monthly limit reached — resets on the 1st",
  "profile.limit_reached_free": "Monthly limit reached — upgrade to continue",
  "profile.remaining_one": "{n} report remaining this month",
  "profile.remaining_other": "{n} reports remaining this month",
  "profile.manage_sub": "Manage subscription",
  "profile.activate_provider_pro": "Activate Provider Pro",
  "profile.provider_pro_plan": "Provider Pro Plan",
  "profile.per_month_nzd": "/mo NZD",
  "profile.agent_pro_includes": "Agent Pro includes",
  "profile.agent_pro_features": "Agent Pro features",
  "profile.provider_pro_includes": "Provider Pro includes",
  "profile.provider_pro_features": "Provider Pro features",
  "profile.standard_includes": "Standard plan includes",
  "profile.free_includes": "Free plan includes",
  "profile.sign_out": "Sign out",
  "profile.delete_account": "Delete account",
  "profile.sign_out_q": "Are you sure you want to sign out?",
  "profile.delete_q": "This will permanently delete your account and all your reports. This cannot be undone.",
  "profile.delete_warn": "All data for {target} will be permanently removed.",
  "profile.delete_confirm": "Yes, delete",
  "profile.delete_account_btn": "Delete my account",
  "profile.error_save": "Could not save your profile. Please try again.",
  "profile.error_save_conn": "Could not save your profile. Check your connection.",
  "profile.error_upload": "Could not upload photo. Please try again.",
  "profile.error_upload_conn": "Could not upload photo. Check your connection.",
  "profile.error_delete": "Could not delete your account. Please try again or contact support.",
  "profile.error_delete_conn": "Could not delete your account. Please check your connection.",
  "profile.permission_required": "Permission required",
  "profile.photo_permission": "Please allow photo library access to update your profile picture.",
  "profile.error": "Error",
  "profile.unavailable": "Unavailable",
  "profile.sub_unavailable": "Subscription packages are not available right now. Please try again later.",
  "profile.almost_there": "Almost there",
  "profile.payment_no_account": "Your payment went through but we couldn't update your account. Please pull to refresh in a moment, or contact support if it persists.",
  "profile.agent_activated_title": "Agent Pro activated!",
  "profile.agent_activated_msg": "You now have full access to your Agent Pro plan.",
  "profile.provider_activated_title": "Provider Pro activated!",
  "profile.provider_activated_msg": "Your profile is now visible to developers.",
  "profile.welcome_standard": "Welcome to Standard!",
  "profile.welcome_standard_msg": "You now have {n} reports per month.",
  "profile.purchase_failed": "Purchase failed",
  "profile.purchase_failed_msg": "Something went wrong. Please try again.",
  "profile.verified": "verified",

  "feature.feasibility_reports": "Feasibility reports",
  "feature.chat_search": "Chat & property search",
  "feature.chat_planners": "In-app chat with planners & architects",
  "feature.unlimited_listings": "Unlimited property listings",
  "feature.featured_search": "Featured in property search",
  "feature.client_tools": "Client feasibility tools",
  "feature.analytics": "Analytics & performance insights",
  "feature.priority_support": "Priority support",
  "feature.referred": "Get referred in chats & search",
  "feature.encrypted_chats": "Encrypted chats with clients & investors",

  // Paywall
  "profile.upgrade_to_standard": "Upgrade to Standard",
  "profile.upgrade_btn": "Upgrade to Standard",
  "feature.more_reports": "More feasibility reports",
  "feature.more_chat_search": "More chat & property search",
  "paywall.title": "Upgrade to Standard",
  "paywall.subtitle": "20 reports per month with full AI-powered property analysis",
  "paywall.f1": "20 feasibility reports per month",
  "paywall.f2": "Complete property data pipeline",
  "paywall.f3": "Risk assessments & ROI modelling",
  "paywall.f4": "Save and revisit past reports",
  "paywall.f5": "Export to PDF (coming soon)",
  "paywall.standard_monthly": "Standard Monthly",
  "paywall.billed_cancel": "Billed monthly · Cancel anytime",
  "paywall.get_standard": "Get Standard",
  "paywall.restoring": "Restoring…",
  "paywall.restore": "Restore purchases",
  "paywall.maybe_later": "Maybe later",
  "paywall.legal": "Payment will be charged to your {store} account at confirmation. Subscriptions automatically renew unless cancelled at least 24 hours before the end of the current period. Manage in your device Settings.",
  "paywall.not_available": "Not available",
  "paywall.iap_required": "In-app purchases require the full app build. If you have already purchased, tap Restore.",
  "paywall.almost_there": "Almost there",
  "paywall.no_account_activate": "Your payment went through but we couldn't activate your account. Please try again in a moment, or contact support if it persists.",
  "paywall.welcome_title": "Welcome to Standard!",
  "paywall.welcome_msg": "You now have 20 reports per month.",
  "paywall.purchase_failed": "Purchase failed",
  "paywall.purchase_failed_msg": "Something went wrong. Please try again.",
  "paywall.restored_title": "Purchases restored",
  "paywall.restored_msg": "Your Standard subscription is active.",
  "paywall.no_purchases": "No purchases found",
  "paywall.no_purchases_msg": "No active Standard subscription was found for this account.",
  "paywall.restore_failed": "Restore failed",
  "paywall.restore_failed_msg": "Could not restore purchases. Please try again.",

  // Common
  "common.error": "Error",
  "common.cancel": "Cancel",
  "common.ok": "OK",
  "common.loading": "Loading…",

  // Messages tab
  "messages.title": "Messages",
  "messages.empty_title": "Empty inbox",
  "messages.empty_desc": "Chats will appear here once you are connected to an agent or a service provider.",
  "messages.empty_sub": "Connections are suggested by AI after your property analysis.",
  "messages.role_sales_agent": "Sales Agent",
  "messages.role_service_provider": "Service Provider",
  "messages.role_user": "User",
  "messages.unknown": "Unknown",
  "messages.photo": "📷 Photo",
  "messages.no_messages_yet": "No messages yet",
  "messages.you_prefix": "You: {preview}",
  "messages.now": "now",
  "messages.recommendation_one": "{n} recommendation",
  "messages.recommendation_other": "{n} recommendations",

  // Signup role-selection
  "signup.brand_tagline": "Residential property development intelligence",
  "signup.heading": "Join Project Alpha",
  "signup.subheading": "Choose the plan that fits your goals",
  "signup.have_account": "Already have an account? ",
  "signup.sign_in": "Sign in",
  "signup.role.general.title": "General User",
  "signup.role.general.tagline": "Explore NZ property intelligence",
  "signup.role.general.badge": "Free",
  "signup.role.general.cta": "Get started",
  "signup.role.general.f1": "Feasibility reports",
  "signup.role.general.f2": "Chat & property search",
  "signup.role.provider.title": "Service Provider",
  "signup.role.provider.tagline": "Connect with developers who need you",
  "signup.role.provider.badge": "14-day free trial",
  "signup.role.provider.cta": "Get started",
  "signup.role.provider.f1": "Get referred in chats & search",
  "signup.role.provider.f2": "Encrypted chats with clients & investors",
  "signup.role.provider.f3": "Feasibility reports",
  "signup.role.provider.f4": "Chat & property search",

  // Search tab extras
  "search.listings": "Listings",
  "search.add_listing": "Add listing",
  "search.new": "New",
  "search.property_loaded": "Property loaded",
  "search.usage_limit_bar": "Usage limit reached — messages refresh on the 1st of next month.",
  "search.no_listings_msg": "No matching listings found right now. Try a different suburb, adjust your budget, or ask again shortly — new listings appear daily.",
  "search.could_clarify": "Could you clarify?",
  "search.which_lot": "Which lot would you like analysed?",
  "search.session_expired": "Session expired. Please sign in again.",
  "search.usage_used_upgrade": "You've used all your reports for this month. Upgrade to Standard for more.",
  "search.usage_limit_short": "You've reached your usage limit for this month. Upgrade to Standard to continue, or wait until your plan refreshes on the 1st.",
  "search.usage_limit_short_free": "You've reached your usage limit for this month. Your messages will refresh on the 1st.",
  "search.slow_data": "NZ property data sources are slow right now. Please tap Try again.",
  "search.cant_reach": "Couldn't reach the service after several attempts. Please check your connection and try again.",
  "search.waking": "Waking up the service…",
  "search.still_fetching": "Still fetching data, one moment…",
  "search.fetching": "Fetching data…",

  // Report sections (most prominent labels)
  "report.overview": "Property Overview",
  "report.scores": "Scores",
  "report.planning": "Planning",
  "report.terrain": "Terrain",
  "report.asbestos": "Asbestos",
  "report.infrastructure": "Infrastructure",
  "report.cost_breakdown": "Cost Breakdown",
  "report.roi_scenarios": "ROI Scenarios",
  "report.comparable_sales": "Comparable Sales",
  "report.risk_summary": "Risk Summary",
  "report.disclaimer": "Disclaimer",
  "report.ease": "Ease",
  "report.cost": "Cost",
  "report.roi": "ROI",
  "report.composite": "Composite",
  "report.address": "Address",
  "report.cv": "Capital Value",
  "report.land_area": "Land area",
  "report.floor_area": "Floor area",
  "report.build_year": "Build year",
  "report.zone": "Zone",
  "report.bedrooms": "Bedrooms",
  "report.bathrooms": "Bathrooms",
  "report.listing_price": "Listing price",
  "report.potential_lots": "Potential lots",
  "report.min_lot_size": "Min lot size",
  "report.total": "Total",
};

const zh: Catalog = {
  // Tabs
  "tab.search": "搜索",
  "tab.messages": "消息",
  "tab.history": "历史",
  "tab.account": "账户",

  // Welcome
  "welcome.eyebrow": "新西兰 · 住宅",
  "welcome.headline_a": "更明智的物业",
  "welcome.headline_b": "决策。",
  "welcome.subhead": "住宅物业开发智能分析。",
  "welcome.cta_primary": "开始使用",
  "welcome.cta_secondary": "我已经有账户",

  // Login
  "login.tagline": "住宅物业开发智能分析",
  "login.heading": "欢迎回来",
  "login.subheading": "登录您的账户以继续",
  "login.email": "邮箱",
  "login.email_ph": "you@example.com",
  "login.password": "密码",
  "login.password_ph": "请输入密码",
  "login.submit": "登录",
  "login.no_account": "还没有账户?",
  "login.sign_up": "注册",
  "login.error_required": "请输入邮箱和密码。",
  "login.error_failed": "登录失败,请重试。",

  // Search / chat input
  "search.placeholder": "询问任何关于新西兰物业的问题…",
  "search.suggestion_1": "Grey Lynn 现在有什么在售?",
  "search.suggestion_2": "查找 200 万以下的开发用地",
  "search.suggestion_3": "分析 Remuera 的 42 Arney Road",
  "search.thinking": "思考中…",
  "search.searching": "正在搜索物业…",
  "search.analysing": "正在分析物业…",
  "search.send": "发送",
  "search.welcome_title": "我能帮您什么?",
  "search.welcome_subtitle": "询问某个物业、搜索某个郊区,或从下面选择一个开始。",
  "search.format_error": "回复格式有问题。请尝试换种方式提问。",

  // History
  "history.title": "历史记录",
  "history.new": "新搜索",
  "history.empty_title": "暂无分析记录",
  "history.empty_text": "您的物业分析将显示在这里。点击任意一项可重新打开并继续对话。",
  "history.empty_btn": "开始分析",
  "history.hint": "点击重新打开 · 长按删除",
  "history.delete_title": "删除报告",
  "history.delete_msg": "从历史中移除此分析?",
  "history.cancel": "取消",
  "history.delete": "删除",
  "history.error_load": "无法加载此报告,请重试。",
  "history.error_delete": "无法删除此报告,请重试。",
  "history.today": "今天",
  "history.yesterday": "昨天",
  "history.days_ago": "{n} 天前",

  // Profile
  "profile.account": "账户",
  "profile.your_details": "个人信息",
  "profile.change_photo": "更换头像",
  "profile.uploading": "上传中…",
  "profile.first_name": "名字",
  "profile.last_name": "姓氏",
  "profile.language": "母语",
  "profile.app_language": "应用语言",
  "profile.app_language_hint": "选择应用界面和 AI 回复使用的语言。",
  "profile.cancel": "取消",
  "profile.save": "保存",
  "profile.name": "姓名",
  "profile.discipline": "专业",
  "profile.edit_details": "编辑信息",
  "profile.current_plan": "当前套餐",
  "profile.standard": "标准版",
  "profile.free_tier": "免费版",
  "profile.free": "免费",
  "profile.reports_used": "本月已使用报告数",
  "profile.limit_reached_standard": "已达到本月上限 — 每月 1 日重置",
  "profile.limit_reached_free": "已达到本月上限 — 升级以继续使用",
  "profile.remaining_one": "本月还剩 {n} 份报告",
  "profile.remaining_other": "本月还剩 {n} 份报告",
  "profile.manage_sub": "管理订阅",
  "profile.activate_provider_pro": "激活 Provider Pro",
  "profile.provider_pro_plan": "Provider Pro 套餐",
  "profile.per_month_nzd": "/月 NZD",
  "profile.agent_pro_includes": "Agent Pro 包含",
  "profile.agent_pro_features": "Agent Pro 功能",
  "profile.provider_pro_includes": "Provider Pro 包含",
  "profile.provider_pro_features": "Provider Pro 功能",
  "profile.standard_includes": "标准版包含",
  "profile.free_includes": "免费版包含",
  "profile.sign_out": "退出登录",
  "profile.delete_account": "删除账户",
  "profile.sign_out_q": "确定要退出登录吗?",
  "profile.delete_q": "此操作将永久删除您的账户和所有报告,无法撤销。",
  "profile.delete_warn": "{target} 的所有数据将被永久删除。",
  "profile.delete_confirm": "是的,删除",
  "profile.delete_account_btn": "删除我的账户",
  "profile.error_save": "无法保存您的资料,请重试。",
  "profile.error_save_conn": "无法保存您的资料,请检查网络连接。",
  "profile.error_upload": "无法上传照片,请重试。",
  "profile.error_upload_conn": "无法上传照片,请检查网络连接。",
  "profile.error_delete": "无法删除账户,请重试或联系客服。",
  "profile.error_delete_conn": "无法删除账户,请检查网络连接。",
  "profile.permission_required": "需要授权",
  "profile.photo_permission": "请允许访问照片库以更新头像。",
  "profile.error": "错误",
  "profile.unavailable": "暂不可用",
  "profile.sub_unavailable": "订阅套餐目前不可用,请稍后再试。",
  "profile.almost_there": "即将完成",
  "profile.payment_no_account": "支付已成功,但账户更新失败。请稍后下拉刷新,如问题持续请联系客服。",
  "profile.agent_activated_title": "Agent Pro 已激活!",
  "profile.agent_activated_msg": "您现已可使用 Agent Pro 全部功能。",
  "profile.provider_activated_title": "Provider Pro 已激活!",
  "profile.provider_activated_msg": "您的资料现在对开发者可见。",
  "profile.welcome_standard": "欢迎使用标准版!",
  "profile.welcome_standard_msg": "您现在每月可使用 {n} 份报告。",
  "profile.purchase_failed": "购买失败",
  "profile.purchase_failed_msg": "出现问题,请重试。",
  "profile.verified": "已认证",

  "feature.feasibility_reports": "可行性分析报告",
  "feature.chat_search": "聊天与物业搜索",
  "feature.chat_planners": "应用内联系规划师与建筑师",
  "feature.unlimited_listings": "无限物业刊登",
  "feature.featured_search": "在物业搜索中优先展示",
  "feature.client_tools": "客户可行性分析工具",
  "feature.analytics": "数据与表现洞察",
  "feature.priority_support": "优先客服支持",
  "feature.referred": "在聊天与搜索中获得推荐",
  "feature.encrypted_chats": "与客户和投资者的加密聊天",

  // Paywall
  "profile.upgrade_to_standard": "升级到标准版",
  "profile.upgrade_btn": "升级到标准版",
  "feature.more_reports": "更多可行性报告",
  "feature.more_chat_search": "更多聊天与物业搜索",
  "paywall.title": "升级到标准版",
  "paywall.subtitle": "每月 20 份完整 AI 物业分析报告",
  "paywall.f1": "每月 20 份可行性报告",
  "paywall.f2": "完整的物业数据分析流程",
  "paywall.f3": "风险评估与 ROI 测算",
  "paywall.f4": "保存并回看历史报告",
  "paywall.f5": "导出 PDF(即将推出)",
  "paywall.standard_monthly": "标准版按月订阅",
  "paywall.billed_cancel": "按月计费 · 随时取消",
  "paywall.get_standard": "获取标准版",
  "paywall.restoring": "恢复中…",
  "paywall.restore": "恢复购买",
  "paywall.maybe_later": "稍后再说",
  "paywall.legal": "费用将在确认时记入您的{store}账户。除非在订阅期结束前至少 24 小时取消,否则订阅将自动续订。可在设备设置中管理。",
  "paywall.not_available": "暂不可用",
  "paywall.iap_required": "应用内购买需要正式版应用。如已购买,请点击「恢复购买」。",
  "paywall.almost_there": "即将完成",
  "paywall.no_account_activate": "支付已成功,但账户激活失败。请稍后再试,如问题持续请联系客服。",
  "paywall.welcome_title": "欢迎使用标准版!",
  "paywall.welcome_msg": "您现在每月可使用 20 份报告。",
  "paywall.purchase_failed": "购买失败",
  "paywall.purchase_failed_msg": "出现问题,请重试。",
  "paywall.restored_title": "购买已恢复",
  "paywall.restored_msg": "您的标准版订阅已激活。",
  "paywall.no_purchases": "未找到购买记录",
  "paywall.no_purchases_msg": "未找到此账户的有效标准版订阅。",
  "paywall.restore_failed": "恢复失败",
  "paywall.restore_failed_msg": "无法恢复购买,请重试。",

  // Common
  "common.error": "错误",
  "common.cancel": "取消",
  "common.ok": "确定",
  "common.loading": "加载中…",

  // Messages tab
  "messages.title": "消息",
  "messages.empty_title": "收件箱为空",
  "messages.empty_desc": "当您与中介或服务提供者建立联系后,聊天将显示在这里。",
  "messages.empty_sub": "AI 会在您完成物业分析后为您推荐联系人。",
  "messages.role_sales_agent": "房产中介",
  "messages.role_service_provider": "服务提供者",
  "messages.role_user": "用户",
  "messages.unknown": "未知",
  "messages.photo": "📷 图片",
  "messages.no_messages_yet": "暂无消息",
  "messages.you_prefix": "您:{preview}",
  "messages.now": "刚刚",
  "messages.recommendation_one": "{n} 条推荐",
  "messages.recommendation_other": "{n} 条推荐",

  // Signup role-selection
  "signup.brand_tagline": "住宅物业开发智能分析",
  "signup.heading": "加入 Project Alpha",
  "signup.subheading": "选择适合您目标的方案",
  "signup.have_account": "已有账户?",
  "signup.sign_in": "登录",
  "signup.role.general.title": "普通用户",
  "signup.role.general.tagline": "探索新西兰物业智能分析",
  "signup.role.general.badge": "免费",
  "signup.role.general.cta": "开始使用",
  "signup.role.general.f1": "可行性分析报告",
  "signup.role.general.f2": "聊天与物业搜索",
  "signup.role.provider.title": "服务提供者",
  "signup.role.provider.tagline": "与有需要的开发商建立联系",
  "signup.role.provider.badge": "14 天免费试用",
  "signup.role.provider.cta": "开始使用",
  "signup.role.provider.f1": "在聊天与搜索中获得推荐",
  "signup.role.provider.f2": "与客户和投资者的加密聊天",
  "signup.role.provider.f3": "可行性分析报告",
  "signup.role.provider.f4": "聊天与物业搜索",

  // Search tab extras
  "search.listings": "刊登",
  "search.add_listing": "发布刊登",
  "search.new": "新建",
  "search.property_loaded": "物业已加载",
  "search.usage_limit_bar": "已达使用上限 — 消息将于下月 1 日重置。",
  "search.no_listings_msg": "暂时没有匹配的房源。请尝试其他郊区、调整预算,或稍后再问 — 每天都有新房源上线。",
  "search.could_clarify": "您能补充说明一下吗?",
  "search.which_lot": "您想分析哪个地块?",
  "search.session_expired": "登录已过期,请重新登录。",
  "search.usage_used_upgrade": "您本月的报告额度已用完。升级到标准版以获取更多。",
  "search.usage_limit_short": "您本月已达使用上限。升级到标准版以继续使用,或等待每月 1 日刷新。",
  "search.usage_limit_short_free": "您本月已达使用上限。消息将于下月 1 日刷新。",
  "search.slow_data": "新西兰物业数据源目前响应较慢,请点击「重试」。",
  "search.cant_reach": "多次尝试后仍无法连接到服务。请检查网络后重试。",
  "search.waking": "正在唤醒服务…",
  "search.still_fetching": "仍在获取数据,请稍候…",
  "search.fetching": "正在获取数据…",

  // Report
  "report.overview": "物业概览",
  "report.scores": "评分",
  "report.planning": "规划",
  "report.terrain": "地形",
  "report.asbestos": "石棉风险",
  "report.infrastructure": "基础设施",
  "report.cost_breakdown": "成本明细",
  "report.roi_scenarios": "投资回报情景",
  "report.comparable_sales": "可比成交",
  "report.risk_summary": "风险摘要",
  "report.disclaimer": "免责声明",
  "report.ease": "可行度",
  "report.cost": "成本",
  "report.roi": "回报",
  "report.composite": "综合",
  "report.address": "地址",
  "report.cv": "政府估值 (CV)",
  "report.land_area": "土地面积",
  "report.floor_area": "建筑面积",
  "report.build_year": "建造年份",
  "report.zone": "分区",
  "report.bedrooms": "卧室数",
  "report.bathrooms": "浴室数",
  "report.listing_price": "挂牌价",
  "report.potential_lots": "潜在地块数",
  "report.min_lot_size": "最小地块面积",
  "report.total": "总计",
};

const CATALOGS: Record<Locale, Catalog> = { en, zh };

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{${k}}`));
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const detected = detectDeviceLocale();
    _setCurrentLocale(detected);
    return detected;
  });

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === "en" || stored === "zh") {
          setLocaleState(stored);
          _setCurrentLocale(stored);
        }
      } catch {}
    })();
  }, []);

  const setLocale = useCallback(async (l: Locale) => {
    setLocaleState(l);
    _setCurrentLocale(l);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, l);
    } catch {}
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const cat = CATALOGS[locale] ?? en;
      const raw = cat[key] ?? en[key] ?? key;
      return interpolate(raw, vars);
    },
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useT(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    return {
      locale: "en",
      setLocale: async () => {},
      t: (key, vars) => interpolate(en[key] ?? key, vars),
    };
  }
  return ctx;
}

// Module-level access to current locale (for non-React code such as fetch helpers).
let _currentLocale: Locale = "en";
export function _setCurrentLocale(l: Locale) {
  _currentLocale = l;
}
export function getCurrentLocale(): Locale {
  return _currentLocale;
}

export function LocaleSync() {
  const { locale } = useT();
  useEffect(() => {
    _setCurrentLocale(locale);
  }, [locale]);
  return null;
}
