<script>
  // Pulsanti touch di movimento: equivalgono ai tasti freccia avanti, sinistra, destra
  let { onmove } = $props();

  const BUTTONS = [
    { direction: 'forward', label: 'Move forward', arrow: '↑', cell: 'col-span-2' },
    { direction: 'left',    label: 'Move left',    arrow: '←', cell: 'col-span-1' },
    { direction: 'right',   label: 'Move right',   arrow: '→', cell: 'col-span-1' },
  ];

  function press(e, direction) {
    // Con la cattura il rilascio arriva al pulsante anche se il dito scivola fuori
    e.currentTarget.setPointerCapture(e.pointerId);
    onmove(direction, true);
  }
</script>

<!-- Sfuma solo l'opacità: i pulsanti invisibili devono continuare a ricevere i tocchi -->
<div class="fixed bottom-6 inset-x-0 z-10 container mx-auto px-4 grid grid-cols-2 gap-2 select-none animate-fade-away">
  {#each BUTTONS as { direction, label, arrow, cell }}
    <button
      aria-label={label}
      class={['h-24 bg-white/5 border border-white/10 text-white/35 text-3xl touch-none active:bg-white/15', cell]}
      onpointerdown={(e) => press(e, direction)}
      onpointerup={() => onmove(direction, false)}
      onpointercancel={() => onmove(direction, false)}
      onlostpointercapture={() => onmove(direction, false)}
      oncontextmenu={(e) => e.preventDefault()}
    >{arrow}</button>
  {/each}
</div>
