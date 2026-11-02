// QGauss AI 客户端视觉组件。
import { defineComponent as defineComponent_0 } from "vue";

import { useRouter as useRouter_1 } from "vue-router";

import { useAuthConfig as useAuthConfig_2 } from "./auth-runtime.js";

import { useAuthSettings as useAuthSettings_3 } from "./auth-runtime.js";

import { computed as computed_4 } from "vue";

import { ref as ref_5 } from "vue";

import { watch as watch_6 } from "vue";

import { onMounted as onMounted_7 } from "vue";

import { onBeforeUnmount as onBeforeUnmount_8 } from "vue";

import { openBlock as openBlock_9 } from "vue";

import { createElementBlock as createElementBlock_10 } from "vue";

import { normalizeClass as normalizeClass_11 } from "vue";

import { createElementVNode as createElementVNode_12 } from "vue";

import { createCommentVNode as createCommentVNode_13 } from "vue";

import { normalizeStyle as normalizeStyle_14 } from "vue";

import { createStaticVNode as createStaticVNode_15 } from "vue";

import { createVNode as createVNode_16 } from "vue";

import { withCtx as withCtx_17 } from "vue";

import { unref as unref_18 } from "vue";

import { toDisplayString as toDisplayString_19 } from "vue";

import { createBlock as createBlock_20 } from "vue";

import { UnavailableAuthMethod as UnavailableAuthMethod_21 } from "./auth-runtime.js";

import AuthForm from "./AuthForm.vue";

import { UnavailableAuthMethod as UnavailableAuthMethod_23 } from "./auth-runtime.js";

import { nextTick as nextTick_24 } from "vue";

import { authText as authText_25 } from "./auth-locale.js";

import { AuthIcon as AuthIcon_26 } from "./auth-runtime.js";

import { Fragment as Fragment_27 } from "vue";

import { renderList as renderList_28 } from "vue";

import { AuthPopover as AuthPopover_29 } from "./auth-runtime.js";

import { AuthButton as AuthButton_30 } from "./auth-runtime.js";

import { createTextVNode as createTextVNode_31 } from "vue";

import { authMethodIcon as authMethodIcon_32 } from "./auth-runtime.js";

import { withScope as withScope_33 } from "./auth-runtime.js";

const jt = {
    key: 0,
    class: "intro-loader-wrap"
}, Jt = {
    class: "right-panel"
}, ea = {
    class: "form-card"
}, ta = {
    class: "form-card-header-tools"
}, aa = [ "aria-label", "aria-expanded" ], na = {
    class: "login-lang-btn__text"
}, la = {
    class: "login-lang-menu"
}, sa = [ "aria-current", "onClick" ], oa = {
    class: "login-lang-option__label"
}, ra = {
    key: 0,
    class: "login-lang-option__check",
    "aria-hidden": "true"
}, ia = {
    class: "form-card-main"
}, ua = {
    key: 0
}, ca = {
    class: "content-wrap"
}, da = {
    class: "bottom-switch"
}, va = {
    class: "bottom-switch"
}, pa = [ "src" ], fa = {
    class: "bottom-switch"
}, ga = [ "src" ], ka = withScope_33(defineComponent_0({
    __name: "Login",
    setup(scene9) {
        const scene12 = useRouter_1(), scene13 = useAuthConfig_2(), scene14 = useAuthSettings_3(), scene15 = computed_4(() => scene14.isDark), scene16 = ref_5("wechat"), scene17 = ref_5(null), scene18 = computed_4(() => 1 === Number(scene13.globalConfig.emailLoginStatus)), scene19 = computed_4(() => 1 === Number(scene13.globalConfig.wechatRegisterStatus)), scene20 = computed_4(() => 1 === Number(scene13.globalConfig.phoneLoginStatus)), scene21 = ref_5("login");
        function scene22(scene23) {
            scene21.value = scene23;
        }
        const scene24 = computed_4(() => {
            if ("wechat" === scene16.value) return authText_25("auth.wechatLogin");
            const scene26 = "phone" === scene16.value ? authText_25("auth.phoneTab") : authText_25("auth.emailTab");
            return "register" === scene21.value ? "" + scene26 + authText_25("auth.registerTab") : "forget" === scene21.value ? authText_25("auth.findPassword") : "phone" === scene16.value ? authText_25("auth.phoneLogin") : authText_25("auth.emailLogin");
        }), scene27 = computed_4(() => "register" === scene21.value ? authText_25("auth.enterRegisterInfo") : "forget" === scene21.value ? authText_25("auth.enterFindPwdInfo") : authText_25("auth.enterLoginInfo")), scene30 = ref_5(!1), scene31 = computed_4(() => scene14.language), scene32 = computed_4(() => [ {
            label: authText_25("layout.langZhCN"),
            key: "zh-CN"
        }, {
            label: authText_25("layout.langZhTW"),
            key: "zh-TW"
        }, {
            label: authText_25("layout.langEnUS"),
            key: "en-US"
        } ]), scene33 = computed_4(() => {
            const scene35 = scene32.value.find(scene36 => scene36.key === scene14.language);
            return (null == scene35 ? void 0 : scene35.label) ?? scene14.language;
        });
        function scene40() {
            scene12.push("/");
        }
        const scene41 = ref_5(0), scene42 = ref_5(0), scene43 = ref_5(!1), scene44 = ref_5(!1), scene45 = ref_5(!1), scene46 = ref_5(0), scene47 = ref_5(0), scene48 = ref_5(!1), scene49 = ref_5(0), scene50 = ref_5(!1), scene51 = ref_5("none"), scene52 = ref_5(!1), scene53 = ref_5(!1), scene54 = ref_5(!1), scene55 = ref_5(!1), scene56 = ref_5(!1);
        let scene57 = null, scene58 = null, scene59 = null, scene60 = null;
        const scene61 = ref_5(!1);
        let scene62 = null, scene63 = null, scene64 = null, scene65 = null, scene66 = null;
        const scene67 = ref_5(!1), scene68 = ref_5("preload"), scene69 = ref_5(!0), scene70 = ref_5(!1), scene71 = ref_5("hidden"), scene72 = ref_5({
            x: 0,
            y: 0
        }), scene73 = ref_5("hidden"), scene74 = ref_5("hidden"), scene75 = ref_5("hidden"), scene76 = [], scene77 = ref_5(!0), scene78 = ref_5(!1), scene79 = ref_5(!1), scene80 = ref_5("off"), scene81 = ref_5("dot"), scene82 = ref_5({
            x: 0,
            y: 0
        }), scene83 = ref_5(!1), scene84 = ref_5(!1), scene85 = ref_5(!1), scene86 = ref_5(!0);
        function scene90(scene91, scene92, scene93) {
            return Math.max(scene92, Math.min(scene93, scene91));
        }
        function scene95(scene96) {
            scene43.value = scene96.isTyping, scene96.passwordLength > 0 && (scene47.value = scene96.passwordLength),
            scene46.value = scene96.passwordLength, scene44.value = scene96.isPasswordFocus,
            scene96.focusedField && (scene51.value = scene96.focusedField), !scene96.isTyping && 0 === scene96.passwordLength && nextTick_24(() => scene98());
        }
        function scene99(scene100) {
            scene45.value = scene100.detail;
        }
        function scene102(scene103) {
            (scene103.detail || !scene67.value) && (scene48.value = scene103.detail);
        }
        function scene105(scene106) {
            scene51.value = scene106.detail;
        }
        function scene98() {
            if (!scene17.value) return;
            const scene113 = scene17.value.getBoundingClientRect();
            scene41.value = scene113.left + .5 * scene113.width, scene42.value = scene113.top + .48 * scene113.height;
        }
        function scene114() {
            const scene116 = window.innerWidth, scene117 = window.innerHeight, scene118 = Math.min(1320, scene116 - 48), scene121 = (scene117 - 800) / 2, scene122 = scene118 * (1.55 / 2.55), scene123 = (scene116 - scene118) / 2 + 12 + Math.max(0, scene122 - 24 - 520) / 2, scene124 = scene121 + 24 + 154;
            scene72.value = {
                x: scene123 + 174.64,
                y: scene124 + 63.60000000000002 - 80
            };
        }
        function scene129() {
            scene131(), scene62 = window.setTimeout(() => {
                scene61.value = !0, scene62 = window.setTimeout(() => {
                    scene61.value = !1, scene45.value && scene46.value > 0 && scene129();
                }, 800);
            }, 3e3 * Math.random() + 2e3);
        }
        function scene131() {
            scene62 && (window.clearTimeout(scene62), scene62 = null);
        }
        watch_6(scene48, scene87 => {
            scene87 ? (scene67.value = !0, scene66 && window.clearTimeout(scene66), scene66 = window.setTimeout(() => {
                scene48.value = !1, scene67.value = !1;
            }, 2e3)) : (scene66 && (window.clearTimeout(scene66), scene66 = null), scene67.value = !1);
        }), watch_6(scene51, (scene151, scene152) => {
            scene64 && (window.clearTimeout(scene64), scene64 = null), "password" !== scene152 && "none" !== scene152 || "password" === scene151 || "none" === scene151 ? scene52.value = !1 : (scene52.value = !0,
            scene64 = window.setTimeout(() => {
                scene52.value = !1, scene64 = null;
            }, 800));
        }), watch_6(scene45, (scene155, scene156) => {
            scene156 !== scene155 && (scene50.value = !0, window.setTimeout(() => {
                scene50.value = !1;
            }, 500), scene155 && (scene49.value = Date.now()));
        }), watch_6([ scene45, scene46 ], ([scene159, scene160]) => {
            scene159 && scene160 > 0 ? scene129() : (scene131(), scene61.value = !1);
        }), watch_6(scene16, () => {
            scene45.value = !1, scene46.value = 0, scene21.value = "login";
        });
        const scene163 = computed_4(() => ({
            transform: "scale(0.88)",
            transformOrigin: "bottom center",
            alignSelf: "center"
        })), scene164 = computed_4(() => scene46.value > 0 && scene45.value), scene165 = computed_4(() => "complete" === scene68.value && "right" === scene80.value ? "email" : scene51.value), scene166 = computed_4(() => "password" !== scene165.value && "none" !== scene165.value), scene167 = computed_4(() => scene166.value || scene46.value > 0 && !scene45.value), scene168 = computed_4(() => "none" !== scene165.value), scene169 = computed_4(() => scene164.value), scene170 = computed_4(() => {
            if (!scene17.value) return {
                faceX: 0,
                faceY: 0,
                bodySkew: 0
            };
            const scene172 = scene17.value.getBoundingClientRect(), scene173 = scene172.left + scene172.width / 2, scene174 = scene172.top + scene172.height / 3;
            let scene175 = scene41.value - scene173, scene176 = scene42.value - scene174;
            return "complete" === scene68.value && "right" === scene80.value && (scene175 = .58 * scene172.width,
            scene176 = .1 * scene172.height), {
                faceX: scene90(scene175 / 20, -15, 15),
                faceY: scene90(scene176 / 30, -10, 10),
                bodySkew: scene90(-scene175 / 120, -6, 6)
            };
        }), scene177 = computed_4(() => {
            const {bodySkew: scene179} = scene170.value;
            return "hidden" === scene74.value ? {
                transform: "translateX(0px) translateY(0px) rotate(0deg) scaleX(1) scaleY(1)",
                height: "420px",
                opacity: "0",
                clipPath: "inset(0 68px 0 68px round 10px 10px 0 0)"
            } : "rolling" === scene74.value ? {
                height: "420px",
                opacity: "1"
            } : scene48.value && !scene45.value ? {
                transform: "translateX(0px)",
                height: "440px"
            } : scene164.value ? {
                transform: "skewX(0deg)",
                height: scene166.value ? "460px" : "420px"
            } : scene167.value ? {
                transform: "skewX(" + ((scene179 || 0) - 12) + "deg) translateX(40px)",
                height: "460px"
            } : {
                transform: "skewX(" + (scene179 || 0) + "deg)",
                height: "420px"
            };
        }), scene180 = computed_4(() => {
            const {bodySkew: scene182} = scene170.value;
            return "done" !== scene73.value ? "hidden" === scene73.value ? {
                height: "290px",
                opacity: "0"
            } : {
                height: "290px",
                opacity: "1"
            } : scene164.value ? {
                transform: "skewX(0deg)",
                height: "290px"
            } : scene52.value ? {
                transform: "skewX(10deg) translateX(15px)",
                height: "290px"
            } : scene167.value ? {
                transform: "skewX(" + 1.5 * (scene182 || 0) + "deg)",
                height: "290px"
            } : {
                transform: "skewX(" + (scene182 || 0) + "deg)",
                height: "290px"
            };
        }), scene183 = computed_4(() => {
            if ("hidden" === scene75.value) return {
                transform: "translateX(0px) translateY(0px) scaleX(1) scaleY(1) rotate(0deg)",
                transformOrigin: "bottom center",
                borderRadius: "120px 120px 0 0",
                opacity: "0"
            };
            if ("arcing" === scene75.value) return {
                transformOrigin: "bottom center",
                opacity: "1"
            };
            if (scene48.value && !scene45.value) return {
                transform: "skewX(-4deg) scaleX(0.96) scaleY(0.92)",
                transformOrigin: "bottom center",
                borderRadius: "92px 166px 0 0"
            };
            if (scene164.value) return {
                transform: "skewX(0deg) scaleX(1) scaleY(1)",
                borderRadius: "120px 120px 0 0",
                transformOrigin: "bottom center"
            };
            const {faceX: scene185, faceY: scene186} = scene170.value, scene187 = .011 * scene186, scene188 = .004 * Math.abs(scene185), scene189 = 1 + scene187 + scene188, scene190 = 1 - scene187 - .45 * scene188, scene191 = .56 * -scene185, scene192 = scene90(138 + 3.5 * scene185 + 1.1 * scene186, 100, 200), scene193 = scene90(138 - 3.5 * scene185 + 1.1 * scene186, 100, 200);
            return {
                transform: "skewX(" + scene191.toFixed(2) + "deg) scaleX(" + scene189.toFixed(3) + ") scaleY(" + scene190.toFixed(3) + ")",
                transformOrigin: "bottom center",
                borderRadius: scene192 + "px " + scene193 + "px 0 0"
            };
        }), scene194 = computed_4(() => "preload" === scene68.value || "reveal" === scene68.value ? {
            transform: "skewX(0deg)",
            height: "0px",
            opacity: "0"
        } : "enter" === scene68.value ? {
            transform: "skewX(0deg)",
            height: "50px",
            opacity: "1"
        } : "animate" === scene68.value ? {
            transform: "skewX(" + (scene170.value.bodySkew || 0) + "deg)",
            height: "220px",
            opacity: "1"
        } : scene164.value ? {
            transform: "skewX(0deg)"
        } : {
            transform: "skewX(" + (scene170.value.bodySkew || 0) + "deg)"
        }), scene195 = computed_4(() => {
            const {faceX: scene197, faceY: scene198} = scene170.value;
            return scene48.value && !scene45.value ? {
                left: 195 + scene197 + "px",
                top: 38 + scene198 + "px"
            } : scene164.value ? {
                left: "131px",
                top: "35px"
            } : scene52.value ? {
                left: "166px",
                top: "65px"
            } : {
                left: 156 + scene197 + "px",
                top: 40 + scene198 + "px"
            };
        }), scene199 = computed_4(() => {
            const {faceX: scene201, faceY: scene202} = scene170.value;
            return scene164.value ? {
                left: "20px",
                top: "28px"
            } : scene52.value ? {
                left: "42px",
                top: "12px"
            } : {
                left: 46 + scene201 + "px",
                top: 32 + scene202 + "px"
            };
        }), scene203 = computed_4(() => {
            const {faceX: scene205, faceY: scene206} = scene170.value;
            return scene48.value && !scene45.value ? {
                left: 153 + 1.8 * scene205 + "px",
                top: 100 + 1.3 * scene206 - .18 * scene205 + "px",
                transform: "rotate(" + (.34 * scene205).toFixed(2) + "deg)"
            } : scene164.value ? {
                left: 36 + .7 * scene205 + "px",
                top: 88 + .6 * scene206 - .14 * scene205 + "px",
                transform: "rotate(" + (.28 * scene205).toFixed(2) + "deg)"
            } : {
                left: 85 + 2.4 * scene205 + "px",
                top: 90 + 1.45 * scene206 - .24 * scene205 + "px",
                transform: "rotate(" + (.42 * scene205).toFixed(2) + "deg)"
            };
        }), scene207 = computed_4(() => {
            const {faceX: scene209, faceY: scene210} = scene170.value;
            return scene164.value ? {
                left: "22px",
                top: "39px"
            } : {
                left: 59 + scene209 + "px",
                top: 55 + scene210 + "px"
            };
        }), scene211 = computed_4(() => {
            const {faceX: scene213, faceY: scene214} = scene170.value;
            return scene48.value ? scene45.value ? {
                left: "14px",
                top: "100px",
                width: "60px",
                height: "12px",
                borderRadius: "0",
                border: "none",
                background: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='12'%3E%3Cpath d='M0 6 Q15 0 30 6 Q45 12 60 6' stroke='%232D2D2D' stroke-width='3' fill='none'/%3E%3C/svg%3E\") no-repeat center",
                transform: "none"
            } : {
                left: "50%",
                top: "98px",
                width: "50px",
                height: "10px",
                borderRadius: "50% 50% 0 0",
                transform: "translateX(-50%) translate(" + .5 * scene213 + "px, " + .5 * scene214 + "px)"
            } : scene164.value ? {
                left: "14px",
                top: "100px",
                transform: "none"
            } : {
                transform: "translateX(-50%) translate(" + .5 * scene213 + "px, " + .5 * scene214 + "px)"
            };
        }), scene215 = computed_4(() => {
            const {faceX: scene217, faceY: scene218} = scene170.value;
            if (scene48.value) {
                const scene219 = {
                    width: "26px",
                    height: "13px",
                    borderRadius: "50% 50% 0 0",
                    background: "transparent",
                    borderTop: "3.5px solid #2D2D2D",
                    transform: "translateX(-50%)",
                    opacity: "1"
                };
                return scene45.value ? {
                    ...scene219,
                    left: "155px",
                    top: "72px"
                } : {
                    ...scene219,
                    left: 215 + scene217 + "px",
                    top: 78 + scene218 + "px"
                };
            }
            return scene164.value ? {
                width: "18px",
                height: "8px",
                borderRadius: "50% 50% 0 0",
                background: "#2D2D2D",
                left: "155px",
                top: "72px",
                transform: "translateX(-50%)",
                opacity: "1"
            } : scene167.value ? {
                width: "6px",
                height: "14px",
                borderRadius: "3px",
                background: "#2D2D2D",
                left: 180 + scene217 + "px",
                top: 82 + scene218 + "px",
                transform: "translateX(-50%)",
                opacity: "1"
            } : {
                width: "16px",
                height: "4px",
                borderRadius: "2px",
                background: "#2D2D2D",
                left: 180 + scene217 + "px",
                top: 80 + scene218 + "px",
                transform: "translateX(-50%)",
                opacity: "1"
            };
        }), scene220 = computed_4(() => {
            const {faceX: scene222, faceY: scene223} = scene170.value;
            if (scene48.value) {
                const scene224 = {
                    width: "24px",
                    height: "12px",
                    borderRadius: "50% 50% 0 0",
                    background: "transparent",
                    borderTop: "3px solid #2D2D2D",
                    transform: "translateX(-50%) rotate(" + (.34 * scene222).toFixed(2) + "deg)"
                };
                return scene45.value ? {
                    ...scene224,
                    left: 67 + .9 * scene222 + "px",
                    top: 113 + .7 * scene223 - .1 * scene222 + "px",
                    transform: "translateX(-50%) rotate(" + (.3 * scene222).toFixed(2) + "deg)"
                } : {
                    ...scene224,
                    left: 181 + 1.8 * scene222 + "px",
                    top: 123 + 1.3 * scene223 - .12 * scene222 + "px"
                };
            }
            return scene164.value ? {
                width: "22px",
                height: "10px",
                borderRadius: "22px 22px 0 0",
                background: "#2D2D2D",
                left: 67 + .8 * scene222 + "px",
                top: 113 + .8 * scene223 - .14 * scene222 + "px",
                transform: "translateX(-50%) rotate(" + (.3 * scene222).toFixed(2) + "deg)"
            } : "password" !== scene165.value || scene45.value ? {
                width: "24px",
                height: "12px",
                borderRadius: "0 0 24px 24px",
                background: "#2D2D2D",
                left: 113 + 2.2 * scene222 + "px",
                top: 117 + 1.6 * scene223 - .16 * scene222 + "px",
                transform: "translateX(-50%) rotate(" + (.34 * scene222).toFixed(2) + "deg)"
            } : {
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: "#2D2D2D",
                left: 113 + 2.1 * scene222 + "px",
                top: 117 + 1.55 * scene223 - .14 * scene222 + "px",
                transform: "translateX(-50%) rotate(" + (.26 * scene222).toFixed(2) + "deg)"
            };
        }), scene225 = computed_4(() => {
            const {faceX: scene227, faceY: scene228} = scene170.value;
            return scene48.value && !scene45.value ? {
                transform: "translate3d(0px, 5px, 0)"
            } : scene164.value ? scene61.value ? {
                transform: "translate3d(4px, 5px, 0)"
            } : {
                transform: "translate3d(-4px, -4px, 0)"
            } : scene52.value ? {
                transform: "translate3d(3px, 4px, 0)"
            } : {
                transform: "translate3d(" + .35 * scene227 + "px, " + .35 * scene228 + "px, 0)"
            };
        }), scene229 = computed_4(() => {
            const {faceX: scene231, faceY: scene232} = scene170.value;
            return scene48.value && !scene45.value ? {
                transform: "translate3d(0px, 5px, 0)"
            } : scene164.value ? {
                transform: "translate3d(-4px, -4px, 0)"
            } : scene52.value ? {
                transform: "translate3d(0px, -4px, 0)"
            } : {
                transform: "translate3d(" + .35 * scene231 + "px, " + .35 * scene232 + "px, 0)"
            };
        }), scene233 = computed_4(() => {
            const {faceX: scene235, faceY: scene236} = scene170.value;
            return scene48.value && !scene45.value ? {
                transform: "translate3d(0px, 3px, 0)"
            } : scene164.value ? {
                transform: "translate3d(-5px, -4px, 0)"
            } : {
                transform: "translate3d(" + .35 * scene235 + "px, " + .35 * scene236 + "px, 0)"
            };
        }), scene237 = computed_4(() => {
            const {faceX: scene239} = scene170.value, scene240 = scene195.value, scene241 = Number.parseFloat(scene240.left), scene242 = Number.parseFloat(scene240.top), scene243 = 3 + .25 * scene239;
            return scene48.value && !scene45.value ? {
                left: scene241 - 38 + "px",
                top: scene242 - 36 + "px",
                transform: "perspective(300px) rotateX(12deg) rotateZ(" + (scene243 - 18).toFixed(2) + "deg)"
            } : {
                left: scene241 - 42 + "px",
                top: scene242 - 42 + "px",
                transform: "perspective(300px) rotateX(12deg) rotateZ(" + scene243.toFixed(2) + "deg)"
            };
        }), scene244 = computed_4(() => "drop" === scene71.value ? {
            transform: "translateY(0px)",
            height: "420px",
            opacity: "1"
        } : "done" === scene71.value ? scene177.value : {
            transform: "translateY(-80px)",
            height: "420px",
            opacity: "0"
        }), scene245 = computed_4(() => {
            const scene247 = "password" === scene51.value && !scene45.value;
            return scene48.value && !scene45.value ? {
                size: 22,
                opacity: .75,
                blur: 6
            } : scene247 ? {
                size: 28,
                opacity: .9,
                blur: 6
            } : scene164.value ? {
                size: 16,
                opacity: .5,
                blur: 4
            } : scene166.value ? {
                size: 20,
                opacity: .6,
                blur: 5
            } : {
                size: 18,
                opacity: .55,
                blur: 4
            };
        }), scene248 = computed_4(() => {
            const {faceX: scene250, faceY: scene251} = scene170.value;
            return scene164.value ? {
                x: 44,
                y: 52
            } : scene52.value ? {
                x: 66,
                y: 36
            } : {
                x: 70 + scene250,
                y: 56 + scene251
            };
        }), scene252 = computed_4(() => {
            const {x: scene254, y: scene255} = scene248.value, scene256 = scene245.value;
            return {
                left: scene254 - 22 + "px",
                top: scene255 + "px",
                width: scene256.size + "px",
                height: Math.round(.65 * scene256.size) + "px",
                opacity: String(scene256.opacity),
                filter: "blur(" + scene256.blur + "px)",
                transform: "translateX(-50%)"
            };
        }), scene257 = computed_4(() => {
            const {x: scene259, y: scene260} = scene248.value, scene261 = scene245.value;
            return {
                left: scene259 + 22 + "px",
                top: scene260 + "px",
                width: scene261.size + "px",
                height: Math.round(.65 * scene261.size) + "px",
                opacity: String(scene261.opacity),
                filter: "blur(" + scene261.blur + "px)",
                transform: "translateX(-50%)"
            };
        });
        return onMounted_7(() => {
            if (scene13.isLogin) return scene69.value = !1, scene68.value = "complete", scene73.value = "done",
            scene74.value = "done", scene75.value = "done", scene71.value = "done", scene70.value = !0,
            scene85.value = !0, scene78.value = !0, scene77.value = !1, scene79.value = !1,
            scene83.value = !0, scene84.value = !0, scene86.value = !1, void scene12.push("/");
            scene19.value ? scene16.value = "wechat" : scene18.value ? scene16.value = "email" : scene16.value = "phone",
            scene114();
            const scene275 = (scene276, scene277) => {
                scene76.push(window.setTimeout(scene276, scene277));
            };
            scene275(() => {
                scene77.value = !1, scene79.value = !0, scene81.value = "dot", scene82.value = {
                    x: window.innerWidth / 2,
                    y: window.innerHeight / 2
                };
            }, 2e3), scene275(() => {
                scene81.value = "lens";
            }, 2100), scene275(() => {
                scene81.value = "glasses", scene78.value = !0, scene114(), scene82.value = {
                    x: scene72.value.x,
                    y: scene72.value.y
                };
            }, 2350), scene275(() => {
                scene69.value = !1, scene68.value = "enter";
            }, 2850);
            const scene285 = 3050 + Math.round(625) + 20;
            scene275(() => {
                scene74.value = "rolling", scene75.value = "arcing", scene73.value = "swing", scene86.value = !1;
            }, 3050), scene275(() => {
                scene85.value = !0;
            }, 3150), scene275(() => {
                scene68.value = "animate", scene63 || (scene63 = scene110 => {
                    scene41.value = scene110.clientX, scene42.value = scene110.clientY;
                }, window.addEventListener("mousemove", scene63)), nextTick_24(() => scene98());
            }, 3650), scene275(() => {
                scene73.value = "drop", scene83.value = !0;
            }, scene285), scene275(() => {
                scene84.value = !0;
            }, 3050 + Math.round(2200) + 25);
            const scene291 = scene285 + 1480, scene292 = scene291 + 12;
            scene275(() => {
                scene73.value = "land";
            }, scene291 + 40), scene275(() => {
                scene74.value = "done", scene75.value = "done";
            }, 5610), scene275(() => {
                scene79.value = !1, scene71.value = "drop", scene70.value = !0;
            }, scene292), scene275(() => {
                scene71.value = "done", scene73.value = "done";
            }, scene292 + 600 + 80), scene275(() => {
                scene68.value = "complete", scene80.value = "right", function() {
                    const scene137 = (scene138, scene139) => {
                        const scene141 = window.setTimeout(() => {
                            scene138(!0), window.setTimeout(() => {
                                scene138(!1), scene137(scene138, scene139);
                            }, 140);
                        }, 3500 * Math.random() + 2500);
                        scene139(scene141);
                    };
                    scene137(scene143 => scene53.value = scene143, scene144 => scene57 = scene144),
                    scene137(scene145 => scene54.value = scene145, scene146 => scene58 = scene146),
                    scene137(scene147 => scene55.value = scene147, scene148 => scene59 = scene148),
                    scene137(scene149 => scene56.value = scene149, scene150 => scene60 = scene150);
                }(), nextTick_24(() => function() {
                    const scene270 = document.querySelector(".right-panel");
                    scene270 && (scene65 = new MutationObserver(scene271 => {
                        scene271.some(scene273 => "attributes" === scene273.type && "type" === scene273.attributeName) && function() {
                            const scene264 = document.querySelector(".right-panel");
                            if (!scene264) return;
                            const scene265 = scene264.querySelectorAll('input[data-qg-password]'), scene266 = Array.from(scene265).some(scene267 => "text" === scene267.type);
                            scene45.value !== scene266 && (scene45.value = scene266, window.dispatchEvent(new CustomEvent("login-password-visibility", {
                                detail: scene266
                            })));
                        }();
                    }), scene65.observe(scene270, {
                        subtree: !0,
                        attributes: !0,
                        attributeFilter: [ "type" ]
                    }));
                }()), window.setTimeout(() => {
                    scene80.value = "off";
                }, 1200);
            }, Math.max(5630, scene292 + 600 + 80) + 50), window.addEventListener("login-password-visibility", scene99),
            window.addEventListener("login-error-state", scene102), window.addEventListener("login-field-focus", scene105);
        }), onBeforeUnmount_8(() => {
            scene76.forEach(scene303 => window.clearTimeout(scene303)), scene63 && (window.removeEventListener("mousemove", scene63),
            scene63 = null), scene131(), null == scene65 || scene65.disconnect(), scene64 && window.clearTimeout(scene64),
            scene57 && window.clearTimeout(scene57), scene58 && window.clearTimeout(scene58),
            scene59 && window.clearTimeout(scene59), scene60 && window.clearTimeout(scene60),
            scene66 && window.clearTimeout(scene66), window.removeEventListener("login-password-visibility", scene99),
            window.removeEventListener("login-error-state", scene102), window.removeEventListener("login-field-focus", scene105);
        }), (scene304, scene305) => (openBlock_9(), createElementBlock_10("div", {
            class: normalizeClass_11([ "login-page", {
                "is-dark": scene15.value,
                "intro-ui-complete": "complete" === scene68.value
            } ])
        }, [ scene69.value ? (openBlock_9(), createElementBlock_10("div", {
            key: 0,
            class: normalizeClass_11([ "intro-overlay", {
                "is-fading": scene78.value
            } ])
        }, [ scene77.value ? (openBlock_9(), createElementBlock_10("div", jt, [ ...scene305[8] || (scene305[8] = [ createElementVNode_12("div", {
            class: "intro-loader-bridge"
        }, null, -1), createElementVNode_12("div", {
            class: "intro-loader-dot top"
        }, null, -1), createElementVNode_12("div", {
            class: "intro-loader-dot bottom"
        }, null, -1) ]) ])) : createCommentVNode_13("", !0) ], 2)) : createCommentVNode_13("", !0), scene79.value ? (openBlock_9(),
        createElementBlock_10("div", {
            key: 1,
            class: normalizeClass_11([ "morph-glasses", "phase-" + scene81.value ]),
            style: normalizeStyle_14({
                left: scene82.value.x + "px",
                top: scene82.value.y + "px"
            })
        }, [ ...scene305[9] || (scene305[9] = [ createStaticVNode_15('<div class="morph-sg" data-v-d89f39b6><div class="psg-arm" data-v-d89f39b6></div><div class="psg-lens" data-v-d89f39b6></div><div class="psg-bridge" data-v-d89f39b6></div><div class="psg-lens" data-v-d89f39b6></div><div class="psg-arm" data-v-d89f39b6></div></div>', 1) ]) ], 6)) : createCommentVNode_13("", !0), createElementVNode_12("div", {
            class: normalizeClass_11([ "login-shell", {
                "intro-shell-hidden": scene69.value && !scene78.value,
                "intro-shell-expanded": scene86.value && scene78.value,
                "intro-shell-clip-loose": "complete" !== scene68.value
            } ])
        }, [ createElementVNode_12("section", {
            ref_key: "leftPanelRef",
            ref: scene17,
            class: normalizeClass_11([ "left-panel", {
                "intro-no-clip": "complete" !== scene68.value
            } ])
        }, [ createElementVNode_12("div", {
            class: normalizeClass_11([ "illustration-wrap", {
                "intro-entering": "complete" !== scene68.value,
                "intro-hide-faces": !scene70.value,
                "intro-show-po-eyes": scene83.value,
                "intro-show-orange-eyes": scene84.value,
                "intro-show-black-eyes": scene85.value
            } ]),
            style: normalizeStyle_14(scene163.value)
        }, [ createElementVNode_12("div", {
            class: normalizeClass_11([ "sg-anchor", {
                "intro-sg-drop": "drop" === scene71.value
            } ]),
            style: normalizeStyle_14("done" === scene71.value ? scene177.value : scene244.value)
        }, [ createElementVNode_12("div", {
            class: "pixel-sg",
            style: normalizeStyle_14(scene237.value)
        }, [ ...scene305[10] || (scene305[10] = [ createStaticVNode_15('<div class="psg-arm" data-v-d89f39b6></div><div class="psg-lens" data-v-d89f39b6></div><div class="psg-bridge" data-v-d89f39b6></div><div class="psg-lens" data-v-d89f39b6></div><div class="psg-arm" data-v-d89f39b6></div>', 5) ]) ], 4) ], 6), createElementVNode_12("div", {
            class: normalizeClass_11([ "figure purple", {
                "is-tilting": !scene168.value,
                "is-error": scene48.value && !scene45.value,
                "is-reveal": scene169.value,
                "is-transitioning": scene50.value,
                "intro-purple-hidden": "hidden" === scene74.value,
                "intro-purple-rolling": "rolling" === scene74.value
            } ]),
            style: normalizeStyle_14(scene177.value)
        }, [ createElementVNode_12("div", {
            class: "eyes",
            style: normalizeStyle_14(scene195.value)
        }, [ createElementVNode_12("span", {
            class: normalizeClass_11([ "eye", {
                blink: scene53.value
            } ])
        }, [ scene53.value ? createCommentVNode_13("", !0) : (openBlock_9(), createElementBlock_10("span", {
            key: 0,
            class: "pupil",
            style: normalizeStyle_14(scene225.value)
        }, null, 4)) ], 2), createElementVNode_12("span", {
            class: normalizeClass_11([ "eye", {
                blink: scene53.value
            } ])
        }, [ scene53.value ? createCommentVNode_13("", !0) : (openBlock_9(), createElementBlock_10("span", {
            key: 0,
            class: "pupil",
            style: normalizeStyle_14(scene225.value)
        }, null, 4)) ], 2) ], 4), createElementVNode_12("span", {
            class: "mouth",
            style: normalizeStyle_14(scene215.value)
        }, null, 4) ], 6), createElementVNode_12("div", {
            class: normalizeClass_11([ "figure black", {
                "is-tilting": !scene168.value,
                "is-error": scene48.value && !scene45.value,
                "is-reveal": scene169.value,
                "is-transitioning": scene50.value,
                "intro-black-hidden": "hidden" === scene73.value,
                "intro-black-swing": "swing" === scene73.value,
                "intro-black-drop": "drop" === scene73.value,
                "intro-black-land": "land" === scene73.value
            } ]),
            style: normalizeStyle_14(scene180.value)
        }, [ createElementVNode_12("div", {
            class: "eyes",
            style: normalizeStyle_14(scene199.value)
        }, [ createElementVNode_12("span", {
            class: normalizeClass_11([ "eye", {
                blink: scene54.value
            } ])
        }, [ scene54.value ? createCommentVNode_13("", !0) : (openBlock_9(), createElementBlock_10("span", {
            key: 0,
            class: "pupil",
            style: normalizeStyle_14(scene229.value)
        }, null, 4)) ], 2), createElementVNode_12("span", {
            class: normalizeClass_11([ "eye", {
                blink: scene54.value
            } ])
        }, [ scene54.value ? createCommentVNode_13("", !0) : (openBlock_9(), createElementBlock_10("span", {
            key: 0,
            class: "pupil",
            style: normalizeStyle_14(scene229.value)
        }, null, 4)) ], 2) ], 4), createElementVNode_12("div", {
            class: "blush blush-l",
            style: normalizeStyle_14(scene252.value)
        }, null, 4), createElementVNode_12("div", {
            class: "blush blush-r",
            style: normalizeStyle_14(scene257.value)
        }, null, 4) ], 6), createElementVNode_12("div", {
            class: normalizeClass_11([ "figure orange", {
                "is-tilting": !scene168.value,
                "is-error": scene48.value && !scene45.value,
                "is-reveal": scene169.value,
                "intro-orange-hidden": "hidden" === scene75.value,
                "intro-orange-arcing": "arcing" === scene75.value
            } ]),
            style: normalizeStyle_14(scene183.value)
        }, [ createElementVNode_12("div", {
            class: "eyes",
            style: normalizeStyle_14(scene203.value)
        }, [ createElementVNode_12("span", {
            class: normalizeClass_11([ "eye", {
                blink: scene55.value
            } ])
        }, [ scene55.value ? createCommentVNode_13("", !0) : (openBlock_9(), createElementBlock_10("span", {
            key: 0,
            class: "pupil",
            style: normalizeStyle_14(scene233.value)
        }, null, 4)) ], 2), createElementVNode_12("span", {
            class: normalizeClass_11([ "eye", {
                blink: scene55.value
            } ])
        }, [ scene55.value ? createCommentVNode_13("", !0) : (openBlock_9(), createElementBlock_10("span", {
            key: 0,
            class: "pupil",
            style: normalizeStyle_14(scene233.value)
        }, null, 4)) ], 2) ], 4), createElementVNode_12("span", {
            class: "mouth",
            style: normalizeStyle_14(scene220.value)
        }, null, 4) ], 6), createElementVNode_12("div", {
            class: normalizeClass_11([ "figure yellow", {
                "is-tilting": !scene168.value,
                "is-error": scene48.value && !scene45.value,
                "is-reveal": scene169.value
            } ]),
            style: normalizeStyle_14(scene194.value)
        }, [ createElementVNode_12("div", {
            class: "eyes",
            style: normalizeStyle_14(scene207.value)
        }, [ createElementVNode_12("span", {
            class: normalizeClass_11([ "eye", {
                blink: scene56.value
            } ])
        }, [ scene56.value ? createCommentVNode_13("", !0) : (openBlock_9(), createElementBlock_10("span", {
            key: 0,
            class: "pupil",
            style: normalizeStyle_14(scene233.value)
        }, null, 4)) ], 2), createElementVNode_12("span", {
            class: normalizeClass_11([ "eye", {
                blink: scene56.value
            } ])
        }, [ scene56.value ? createCommentVNode_13("", !0) : (openBlock_9(), createElementBlock_10("span", {
            key: 0,
            class: "pupil",
            style: normalizeStyle_14(scene233.value)
        }, null, 4)) ], 2) ], 4), createElementVNode_12("span", {
            class: "mouth",
            style: normalizeStyle_14(scene211.value)
        }, null, 4) ], 6) ], 6) ], 2), createElementVNode_12("section", Jt, [ createElementVNode_12("div", ea, [ createElementVNode_12("div", ta, [ createVNode_16(unref_18(AuthPopover_29), {
            show: scene30.value,
            "onUpdate:show": scene305[0] || (scene305[0] = scene306 => scene30.value = scene306),
            trigger: "click"
        }, {
            trigger: withCtx_17(() => [ createElementVNode_12("button", {
                type: "button",
                class: "login-lang-btn",
                "aria-label": unref_18(authText_25)("setting.language"),
                "aria-expanded": scene30.value
            }, [ createVNode_16(unref_18(AuthIcon_26), {
                icon: "ri:translate-2",
                class: "login-lang-btn__icon"
            }), createElementVNode_12("span", na, toDisplayString_19(scene33.value), 1) ], 8, aa) ]),
            default: withCtx_17(() => [ createElementVNode_12("div", la, [ (openBlock_9(!0),
            createElementBlock_10(Fragment_27, null, renderList_28(scene32.value, scene307 => (openBlock_9(),
            createElementBlock_10("button", {
                key: scene307.key,
                type: "button",
                class: normalizeClass_11([ "login-lang-option", {
                    "login-lang-option--active": scene307.key === scene31.value
                } ]),
                "aria-current": scene307.key === scene31.value ? "true" : void 0,
                onClick: scene308 => {
                    return scene38 = scene307.key, scene14.setLanguage(scene38), void (scene30.value = !1);
                    var scene38;
                }
            }, [ createElementVNode_12("span", oa, toDisplayString_19(scene307.label), 1), scene307.key === scene31.value ? (openBlock_9(),
            createElementBlock_10("span", ra, "✓")) : createCommentVNode_13("", !0) ], 10, sa))), 128)) ]) ]),
            _: 1
        }, 8, [ "show" ]), createElementVNode_12("button", {
            class: "back-btn",
            "aria-label": authText_25("closeLogin"),
            type: "button",
            onClick: scene40
        }, [ createVNode_16(unref_18(AuthIcon_26), {
            icon: "ic:twotone-close",
            class: "text-[16px] text-[#000]"
        }) ], 8, [ "aria-label" ]) ]), scene305[11] || (scene305[11] = createElementVNode_12("div", {
            class: "form-card-body-spacer",
            "aria-hidden": "true"
        }, null, -1)), createElementVNode_12("div", ia, [ createElementVNode_12("h1", null, toDisplayString_19(scene24.value), 1), "wechat" !== scene16.value ? (openBlock_9(),
        createElementBlock_10("p", ua, toDisplayString_19(scene27.value), 1)) : createCommentVNode_13("", !0), createElementVNode_12("div", ca, [ "wechat" === scene16.value ? (openBlock_9(),
        createBlock_20(UnavailableAuthMethod_21, {
            key: 0,
            "hide-title": "",
            onChangeLoginType: scene305[3] || (scene305[3] = scene309 => scene16.value = scene309)
        }, {
            switch: withCtx_17(() => [ createElementVNode_12("div", da, [ scene18.value ? (openBlock_9(),
            createBlock_20(unref_18(AuthButton_30), {
                key: 0,
                round: "",
                strong: "",
                type: "default",
                onClick: scene305[1] || (scene305[1] = scene310 => scene16.value = "email")
            }, {
                default: withCtx_17(() => [ createVNode_16(unref_18(AuthIcon_26), {
                    icon: "fe:mail",
                    class: "btn-switch-icon"
                }), createTextVNode_31(" " + toDisplayString_19(scene304.$t("auth.emailLogin")), 1) ]),
                _: 1
            })) : createCommentVNode_13("", !0), scene20.value ? (openBlock_9(), createBlock_20(unref_18(AuthButton_30), {
                key: 1,
                round: "",
                strong: "",
                type: "default",
                onClick: scene305[2] || (scene305[2] = scene311 => scene16.value = "phone")
            }, {
                default: withCtx_17(() => [ createVNode_16(unref_18(AuthIcon_26), {
                    icon: "mage:phone-fill",
                    class: "btn-switch-icon"
                }), createTextVNode_31(" " + toDisplayString_19(scene304.$t("auth.phoneLogin")), 1) ]),
                _: 1
            })) : createCommentVNode_13("", !0) ]) ]),
            _: 1
        })) : "email" === scene16.value ? (openBlock_9(), createBlock_20(AuthForm, {
            key: 1,
            onInteraction: scene95,
            onSubViewChange: scene22
        }, {
            switch: withCtx_17(() => [ createElementVNode_12("div", va, [ scene19.value ? (openBlock_9(),
            createBlock_20(unref_18(AuthButton_30), {
                key: 0,
                round: "",
                strong: "",
                type: "default",
                onClick: scene305[4] || (scene305[4] = scene312 => scene16.value = "wechat")
            }, {
                default: withCtx_17(() => [ createElementVNode_12("img", {
                    src: unref_18(authMethodIcon_32),
                    class: "btn-switch-icon-img",
                    alt: ""
                }, null, 8, pa), createTextVNode_31(" " + toDisplayString_19(scene304.$t("auth.wechatLogin")), 1) ]),
                _: 1
            })) : createCommentVNode_13("", !0), scene20.value ? (openBlock_9(), createBlock_20(unref_18(AuthButton_30), {
                key: 1,
                round: "",
                strong: "",
                type: "default",
                onClick: scene305[5] || (scene305[5] = scene313 => scene16.value = "phone")
            }, {
                default: withCtx_17(() => [ createVNode_16(unref_18(AuthIcon_26), {
                    icon: "mage:phone-fill",
                    class: "btn-switch-icon"
                }), createTextVNode_31(" " + toDisplayString_19(scene304.$t("auth.phoneLogin")), 1) ]),
                _: 1
            })) : createCommentVNode_13("", !0) ]) ]),
            _: 1
        })) : (openBlock_9(), createBlock_20(UnavailableAuthMethod_23, {
            key: 2,
            onInteraction: scene95,
            onSubViewChange: scene22
        }, {
            switch: withCtx_17(() => [ createElementVNode_12("div", fa, [ scene19.value ? (openBlock_9(),
            createBlock_20(unref_18(AuthButton_30), {
                key: 0,
                round: "",
                strong: "",
                type: "default",
                onClick: scene305[6] || (scene305[6] = scene314 => scene16.value = "wechat")
            }, {
                default: withCtx_17(() => [ createElementVNode_12("img", {
                    src: unref_18(authMethodIcon_32),
                    class: "btn-switch-icon-img",
                    alt: ""
                }, null, 8, ga), createTextVNode_31(" " + toDisplayString_19(scene304.$t("auth.wechatLogin")), 1) ]),
                _: 1
            })) : createCommentVNode_13("", !0), scene18.value ? (openBlock_9(), createBlock_20(unref_18(AuthButton_30), {
                key: 1,
                round: "",
                strong: "",
                type: "default",
                onClick: scene305[7] || (scene305[7] = scene315 => scene16.value = "email")
            }, {
                default: withCtx_17(() => [ createVNode_16(unref_18(AuthIcon_26), {
                    icon: "fe:mail",
                    class: "btn-switch-icon"
                }), createTextVNode_31(" " + toDisplayString_19(scene304.$t("auth.emailLogin")), 1) ]),
                _: 1
            })) : createCommentVNode_13("", !0) ]) ]),
            _: 1
        })) ]) ]), scene305[12] || (scene305[12] = createElementVNode_12("div", {
            class: "form-card-body-spacer",
            "aria-hidden": "true"
        }, null, -1)) ]) ]) ], 2) ], 2));
    }
}), [ [ "__scopeId", "data-v-d89f39b6" ] ]);

export { ka as default };
