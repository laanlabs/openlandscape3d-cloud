<script lang="ts">
  let { size = 28, word = false }: { size?: number; word?: boolean } = $props();
</script>

<span class="logo">
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent)" />
    <path d="M16 26V14" stroke="#fff" stroke-width="2" stroke-linecap="round" />
    <path d="M16 15c0-5 3-8 8-8 0 5-3 8-8 8ZM16 19c0-4-2.5-6.5-7-6.5 0 4 2.5 6.5 7 6.5Z" fill="#fff" />
    <path d="M7 26h18" stroke="#cfe3c7" stroke-width="2" stroke-linecap="round" />
  </svg>
  {#if word}<span class="word">OpenLandscape<b>3D</b></span>{/if}
</span>

<style>
  .logo { display: inline-flex; align-items: center; gap: 8px; color: var(--ink); }
  .word { font-family: var(--serif); font-weight: 600; font-size: 18px; letter-spacing: -.01em; }
  .word b { color: var(--accent); font-weight: 600; }
</style>
