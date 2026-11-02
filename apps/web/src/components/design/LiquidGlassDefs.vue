<template>
  <svg class="qgd-glass-defs" width="0" height="0" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="qgd-liquid-refraction" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.014 0.022" numOctaves="2" seed="8" result="liquidMap" />
      <feDisplacementMap in="SourceGraphic" in2="liquidMap" scale="14" xChannelSelector="R" yChannelSelector="G" />
    </filter></defs>
  </svg>
</template>
