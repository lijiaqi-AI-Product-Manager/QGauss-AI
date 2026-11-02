// QGauss AI 客户端视觉组件。
import { defineComponent, ref, watch, onMounted, onUnmounted, openBlock, createElementBlock, Fragment, createElementVNode, toDisplayString, normalizeClass, withDirectives, vShow } from "vue";

const U = {
    class: "typewriter-text center-expand-left"
}, j = {
    class: "typewriter-text center-expand-right"
}, A = {
    class: "typewriter-text"
}, QGaussTypedText = defineComponent({
    __name: "TypeWriter",
    props: {
        text: {},
        typeSpeed: {
            default: 75
        },
        backSpeed: {
            default: 50
        },
        delay: {
            default: 2e3
        },
        showCursor: {
            type: Boolean,
            default: !0
        },
        loop: {
            type: Boolean,
            default: !1
        },
        cursorStyle: {
            default: "default"
        },
        backDelay: {
            default: 1e3
        },
        centerExpand: {
            type: Boolean,
            default: !1
        }
    },
    setup(typed1) {
        let startupTimer = null;
        const typed3 = typed1, typed4 = ref(""), typed5 = ref(""), typed6 = ref(""), typed7 = ref(0), typed8 = ref(!1), typed9 = ref(typed3.showCursor);
        let typed10 = null, typed11 = null, typed12 = null;
        const typed13 = ref(!1), typed14 = () => {
            const typed16 = typed3.text || "探索无限可能，与AI一同开创智慧未来！";
            if (!typed16 || !typed16.trim()) return typed4.value = typed16, void (typed3.centerExpand && (typed5.value = "",
            typed6.value = typed16));
            if (typed3.centerExpand) {
                const typed17 = typed16.length, typed18 = Math.floor(typed17 / 2);
                if (typed13.value) if (typed7.value > 0) {
                    const typed19 = typed7.value - 1;
                    if (typed19 < typed18) typed5.value = typed16.substring(0, typed19), typed6.value = ""; else {
                        const typed20 = typed19 - typed18, typed21 = typed16.substring(0, typed18), typed22 = typed16.substring(typed18), typed23 = Math.min(typed20, Math.floor(typed22.length / 2)), typed24 = typed20 - typed23;
                        typed5.value = typed21 + typed22.substring(0, typed23), typed6.value = typed22.substring(typed23, typed23 + typed24);
                    }
                    typed7.value--, typed8.value = !0, typed10 = setTimeout(typed14, typed3.backSpeed);
                } else typed5.value = "", typed6.value = "", typed13.value = !1, typed8.value = !1,
                typed3.delay > 0 ? typed11 = setTimeout(() => {
                    typed8.value = !0, typed14();
                }, typed3.delay) : (typed8.value = !0, typed14()); else if (typed7.value < typed17) {
                    const typed25 = typed7.value;
                    if (typed25 < typed18) typed5.value = typed16.substring(0, typed25 + 1), typed6.value = ""; else {
                        const typed26 = typed25 - typed18, typed27 = typed16.substring(0, typed18), typed28 = typed16.substring(typed18), typed29 = Math.min(typed26, Math.floor(typed28.length / 2)), typed30 = typed26 - typed29;
                        typed5.value = typed27 + typed28.substring(0, typed29), typed6.value = typed28.substring(typed29, typed29 + typed30 + 1);
                    }
                    typed7.value++, typed8.value = !0, typed10 = setTimeout(typed14, typed3.typeSpeed);
                } else {
                    const typed31 = typed16.substring(0, typed18), typed32 = typed16.substring(typed18), typed33 = Math.floor(typed32.length / 2);
                    typed5.value = typed31 + typed32.substring(0, typed33), typed6.value = typed32.substring(typed33),
                    typed8.value = !1, typed3.loop ? typed12 = setTimeout(() => {
                        typed13.value = !0, typed8.value = !0, typed14();
                    }, typed3.backDelay) : typed3.showCursor || (typed9.value = !1);
                }
            } else typed13.value ? typed7.value > 0 ? (typed4.value = typed16.substring(0, typed7.value - 1),
            typed7.value--, typed8.value = !0, typed10 = setTimeout(typed14, typed3.backSpeed)) : (typed13.value = !1,
            typed8.value = !1, typed3.delay > 0 ? typed11 = setTimeout(() => {
                typed8.value = !0, typed14();
            }, typed3.delay) : (typed8.value = !0, typed14())) : typed7.value < typed16.length ? (typed4.value = typed16.substring(0, typed7.value + 1),
            typed7.value++, typed8.value = !0, typed10 = setTimeout(typed14, typed3.typeSpeed)) : (typed8.value = !1,
            typed3.loop ? typed12 = setTimeout(() => {
                typed13.value = !0, typed8.value = !0, typed14();
            }, typed3.backDelay) : typed3.showCursor || (typed9.value = !1));
        }, typed36 = () => {
            typed10 && (clearTimeout(typed10), typed10 = null), typed11 && (clearTimeout(typed11),
            typed11 = null), typed12 && (clearTimeout(typed12), typed12 = null), typed4.value = "",
            typed5.value = "", typed6.value = "", typed7.value = 0, typed8.value = !0, typed13.value = !1,
            typed9.value = typed3.showCursor, typed3.text && typed3.text.trim() && typed14();
        };
        return watch(() => typed3.text, typed38 => {
            typed38 && typed38.trim() && typed36();
        }), onMounted(() => {
            startupTimer = setTimeout(() => {
                typed3.text && typed3.text.trim() && typed36();
            }, 500);
        }), onUnmounted(() => {
            null !== startupTimer && clearTimeout(startupTimer), typed10 && clearTimeout(typed10),
            typed11 && clearTimeout(typed11), typed12 && clearTimeout(typed12);
        }), (typed41, typed42) => (openBlock(), createElementBlock("span", {
            class: normalizeClass([ "typewriter-container", {
                "center-expand": typed3.centerExpand
            } ])
        }, [ typed3.centerExpand ? (openBlock(), createElementBlock(Fragment, {
            key: 0
        }, [ createElementVNode("span", U, toDisplayString(typed5.value || " "), 1), createElementVNode("span", j, toDisplayString(typed6.value || " "), 1), createElementVNode("span", {
            class: normalizeClass([ "typed-cursor typed-cursor-vertical", {
                "typed-cursor--blink": !typed8.value && !typed13.value,
                "typed-cursor--hidden": !typed9.value
            } ])
        }, null, 2) ], 64)) : (openBlock(), createElementBlock(Fragment, {
            key: 1
        }, [ createElementVNode("span", A, toDisplayString(typed4.value), 1), withDirectives(createElementVNode("span", {
            class: normalizeClass([ "typed-cursor", [ {
                "typed-cursor--blink": !typed8.value && !typed13.value
            }, "cursor-" + typed1.cursorStyle, {
                "smooth-blink": "smooth" === typed1.cursorStyle
            }, {
                "cursor-dot": "dot" === typed1.cursorStyle
            }, {
                "typed-cursor--breath": "dot" === typed1.cursorStyle && !typed8.value && !typed13.value
            } ] ])
        }, toDisplayString("block" === typed1.cursorStyle ? "█" : "dot" === typed1.cursorStyle || "default" === typed1.cursorStyle ? "" : "|"), 3), [ [ vShow, typed9.value ] ]) ], 64)) ], 2));
    }
});

QGaussTypedText.__scopeId = "data-v-53d4a272";

export default QGaussTypedText;
