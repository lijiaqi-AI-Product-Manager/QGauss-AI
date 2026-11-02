// QGauss AI 客户端视觉组件。
import { defineComponent, ref, computed, onMounted, onBeforeUnmount, nextTick, openBlock, createElementBlock, createElementVNode, normalizeStyle, createStaticVNode } from "vue";

const yd = {
    class: "empty-chat-figures-root",
    "aria-hidden": "true"
}, bd = {
    class: "eye"
}, wd = {
    class: "eye"
}, kd = {
    class: "eye"
}, _d = {
    class: "eye"
}, Cd = {
    class: "eye"
}, Ad = {
    class: "eye"
}, $d = {
    class: "eye"
}, Id = {
    class: "eye"
}, QGaussFigures = defineComponent({
    __name: "EmptyChatCharacterFigures",
    props: {
        compact: {
            type: Boolean,
            default: !1
        }
    },
    setup(figure1) {
        const figure3 = figure1, figure4 = ref(null), figure5 = ref(0), figure6 = ref(0);
        let figure7 = null;
        function figure8(figure9, figure10, figure11) {
            return Math.max(figure10, Math.min(figure11, figure9));
        }
        const figure22 = computed(() => {
            if (!figure4.value) return {
                faceX: 0,
                faceY: 0,
                bodySkew: 0
            };
            const figure24 = figure4.value.getBoundingClientRect(), figure25 = figure24.left + figure24.width / 2, figure26 = figure24.top + figure24.height / 3, figure27 = figure5.value - figure25, figure28 = figure6.value - figure26;
            return {
                faceX: figure8(figure27 / 20, -15, 15),
                faceY: figure8(figure28 / 30, -10, 10),
                bodySkew: figure8(-figure27 / 120, -6, 6)
            };
        }), figure29 = computed(() => figure3.compact ? .48 : .58), figure30 = computed(() => ({
            width: 520 * figure29.value + "px",
            height: 420 * figure29.value + "px"
        })), figure31 = computed(() => ({
            position: "absolute",
            left: "50%",
            bottom: 0,
            width: "520px",
            height: "420px",
            transform: "translateX(-50%) scale(" + figure29.value + ")",
            transformOrigin: "bottom center"
        })), figure32 = computed(() => {
            const {bodySkew: figure34} = figure22.value;
            return {
                transform: "skewX(" + (figure34 || 0) + "deg)",
                height: "420px"
            };
        }), figure35 = computed(() => {
            const {bodySkew: figure37} = figure22.value;
            return {
                transform: "skewX(" + (figure37 || 0) + "deg)",
                height: "290px"
            };
        }), figure38 = computed(() => {
            const {faceX: figure40, faceY: figure41} = figure22.value, figure42 = .011 * figure41, figure43 = .004 * Math.abs(figure40), figure44 = 1 + figure42 + figure43, figure45 = 1 - figure42 - .45 * figure43, figure46 = .56 * -figure40, figure47 = figure8(138 + 3.5 * figure40 + 1.1 * figure41, 100, 200), figure48 = figure8(138 - 3.5 * figure40 + 1.1 * figure41, 100, 200);
            return {
                transform: "skewX(" + figure46.toFixed(2) + "deg) scaleX(" + figure44.toFixed(3) + ") scaleY(" + figure45.toFixed(3) + ")",
                transformOrigin: "bottom center",
                borderRadius: figure47 + "px " + figure48 + "px 0 0"
            };
        }), figure49 = computed(() => ({
            transform: "skewX(" + (figure22.value.bodySkew || 0) + "deg)"
        })), figure50 = computed(() => {
            const {faceX: figure52, faceY: figure53} = figure22.value;
            return {
                left: 156 + figure52 + "px",
                top: 40 + figure53 + "px"
            };
        }), figure54 = computed(() => {
            const {faceX: figure56, faceY: figure57} = figure22.value;
            return {
                left: 46 + figure56 + "px",
                top: 32 + figure57 + "px"
            };
        }), figure58 = computed(() => {
            const {faceX: figure60, faceY: figure61} = figure22.value;
            return {
                left: 85 + 2.4 * figure60 + "px",
                top: 90 + 1.45 * figure61 - .24 * figure60 + "px",
                transform: "rotate(" + (.42 * figure60).toFixed(2) + "deg)"
            };
        }), figure62 = computed(() => {
            const {faceX: figure63, faceY: figure64} = figure22.value;
            return {
                left: 59 + figure63 + "px",
                top: 55 + figure64 + "px"
            };
        }), figure65 = computed(() => {
            const {faceX: figure67, faceY: figure68} = figure22.value;
            return {
                transform: "translateX(-50%) translate(" + .5 * figure67 + "px, " + .5 * figure68 + "px)"
            };
        }), figure69 = computed(() => {
            const {faceX: figure71, faceY: figure72} = figure22.value;
            return {
                width: "16px",
                height: "4px",
                borderRadius: "2px",
                background: "#2D2D2D",
                left: 180 + figure71 + "px",
                top: 80 + figure72 + "px",
                transform: "translateX(-50%)",
                opacity: "1"
            };
        }), figure73 = computed(() => {
            const {faceX: figure75, faceY: figure76} = figure22.value;
            return {
                width: "24px",
                height: "12px",
                borderRadius: "0 0 24px 24px",
                background: "#2D2D2D",
                left: 113 + 2.2 * figure75 + "px",
                top: 117 + 1.6 * figure76 - .16 * figure75 + "px",
                transform: "translateX(-50%) rotate(" + (.34 * figure75).toFixed(2) + "deg)"
            };
        }), figure77 = computed(() => {
            const {faceX: figure79, faceY: figure80} = figure22.value;
            return {
                transform: "translate3d(" + .35 * figure79 + "px, " + .35 * figure80 + "px, 0)"
            };
        }), figure81 = computed(() => {
            const {faceX: figure83, faceY: figure84} = figure22.value;
            return {
                transform: "translate3d(" + .35 * figure83 + "px, " + .35 * figure84 + "px, 0)"
            };
        }), figure85 = computed(() => {
            const {faceX: figure87, faceY: figure88} = figure22.value;
            return {
                transform: "translate3d(" + .35 * figure87 + "px, " + .35 * figure88 + "px, 0)"
            };
        }), figure89 = computed(() => {
            const {faceX: figure91} = figure22.value, figure92 = figure50.value;
            return {
                left: Number.parseFloat(figure92.left) - 42 + "px",
                top: Number.parseFloat(figure92.top) - 42 + "px",
                transform: "perspective(300px) rotateX(12deg) rotateZ(" + (3 + .25 * figure91).toFixed(2) + "deg)"
            };
        }), figure96 = computed(() => {
            const {faceX: figure98, faceY: figure99} = figure22.value;
            return {
                left: 70 + figure98 - 22 + "px",
                top: 56 + figure99 + "px",
                width: "18px",
                height: Math.round(.65 * 18) + "px",
                opacity: String(.55),
                filter: "blur(4px)",
                transform: "translateX(-50%)"
            };
        }), figure103 = computed(() => {
            const {faceX: figure105, faceY: figure106} = figure22.value;
            return {
                left: 70 + figure105 + 22 + "px",
                top: 56 + figure106 + "px",
                width: "18px",
                height: Math.round(.65 * 18) + "px",
                opacity: String(.55),
                filter: "blur(4px)",
                transform: "translateX(-50%)"
            };
        });
        return onMounted(() => {
            figure7 || (figure7 = figure15 => {
                figure5.value = figure15.clientX, figure6.value = figure15.clientY;
            }, window.addEventListener("mousemove", figure7)), nextTick(() => function() {
                if (!figure4.value) return;
                const figure19 = figure4.value.getBoundingClientRect();
                figure5.value = figure19.left + .5 * figure19.width, figure6.value = figure19.top + .48 * figure19.height;
            }());
        }), onBeforeUnmount(() => {
            figure7 && (window.removeEventListener("mousemove", figure7), figure7 = null);
        }), (figure110, figure111) => (openBlock(), createElementBlock("div", yd, [ createElementVNode("div", {
            class: "figures-size-box",
            style: normalizeStyle(figure30.value)
        }, [ createElementVNode("div", {
            ref_key: "illustrationRef",
            ref: figure4,
            class: "illustration-wrap",
            style: normalizeStyle(figure31.value)
        }, [ createElementVNode("div", {
            class: "sg-anchor",
            style: normalizeStyle(figure32.value)
        }, [ createElementVNode("div", {
            class: "pixel-sg",
            style: normalizeStyle(figure89.value)
        }, [ ...figure111[0] || (figure111[0] = [ createStaticVNode('<div class="psg-arm" data-v-b144550d></div><div class="psg-lens" data-v-b144550d></div><div class="psg-bridge" data-v-b144550d></div><div class="psg-lens" data-v-b144550d></div><div class="psg-arm" data-v-b144550d></div>', 5) ]) ], 4) ], 4), createElementVNode("div", {
            class: "figure purple",
            style: normalizeStyle(figure32.value)
        }, [ createElementVNode("div", {
            class: "eyes",
            style: normalizeStyle(figure50.value)
        }, [ createElementVNode("span", bd, [ createElementVNode("span", {
            class: "pupil",
            style: normalizeStyle(figure77.value)
        }, null, 4) ]), createElementVNode("span", wd, [ createElementVNode("span", {
            class: "pupil",
            style: normalizeStyle(figure77.value)
        }, null, 4) ]) ], 4), createElementVNode("span", {
            class: "mouth",
            style: normalizeStyle(figure69.value)
        }, null, 4) ], 4), createElementVNode("div", {
            class: "figure black",
            style: normalizeStyle(figure35.value)
        }, [ createElementVNode("div", {
            class: "eyes",
            style: normalizeStyle(figure54.value)
        }, [ createElementVNode("span", kd, [ createElementVNode("span", {
            class: "pupil",
            style: normalizeStyle(figure81.value)
        }, null, 4) ]), createElementVNode("span", _d, [ createElementVNode("span", {
            class: "pupil",
            style: normalizeStyle(figure81.value)
        }, null, 4) ]) ], 4), createElementVNode("div", {
            class: "blush blush-l",
            style: normalizeStyle(figure96.value)
        }, null, 4), createElementVNode("div", {
            class: "blush blush-r",
            style: normalizeStyle(figure103.value)
        }, null, 4) ], 4), createElementVNode("div", {
            class: "figure orange",
            style: normalizeStyle(figure38.value)
        }, [ createElementVNode("div", {
            class: "eyes",
            style: normalizeStyle(figure58.value)
        }, [ createElementVNode("span", Cd, [ createElementVNode("span", {
            class: "pupil",
            style: normalizeStyle(figure85.value)
        }, null, 4) ]), createElementVNode("span", Ad, [ createElementVNode("span", {
            class: "pupil",
            style: normalizeStyle(figure85.value)
        }, null, 4) ]) ], 4), createElementVNode("span", {
            class: "mouth",
            style: normalizeStyle(figure73.value)
        }, null, 4) ], 4), createElementVNode("div", {
            class: "figure yellow",
            style: normalizeStyle(figure49.value)
        }, [ createElementVNode("div", {
            class: "eyes",
            style: normalizeStyle(figure62.value)
        }, [ createElementVNode("span", $d, [ createElementVNode("span", {
            class: "pupil",
            style: normalizeStyle(figure85.value)
        }, null, 4) ]), createElementVNode("span", Id, [ createElementVNode("span", {
            class: "pupil",
            style: normalizeStyle(figure85.value)
        }, null, 4) ]) ], 4), createElementVNode("span", {
            class: "mouth",
            style: normalizeStyle(figure65.value)
        }, null, 4) ], 4) ], 4) ], 4) ]));
    }
});

QGaussFigures.__scopeId = "data-v-b144550d";

export default QGaussFigures;
