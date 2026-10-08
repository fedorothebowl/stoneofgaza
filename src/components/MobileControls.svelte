<script>
  // Pulsanti touch di movimento: equivalgono ai tasti freccia avanti, sinistra, destra
  let { onmove } = $props();

  const BUTTONS = [
    { direction: 'forward', label: 'Move forward', arrow: '↑', cell: 'col-start-2 row-start-1' },
    { direction: 'left',    label: 'Move left',    arrow: '←', cell: 'col-start-1 row-start-2' },
    { direction: 'right',   label: 'Move right',   arrow: '→', cell: 'col-start-3 row-start-2' },
  ];

  function press(e, direction) {
    // Con la cattura il rilascio arriva al pulsante anche se il dito scivola fuori
    e.currentTarget.setPointerCapture(e.pointerId);
    onmove(direction, true);
  }
</script>

<div class="fixed bottom-6 inset-x-0 z-10 mx-auto w-max grid grid-cols-3 gap-2 select-none">
  {#each BUTTONS as { direction, label, arrow, cell }}
    <button
      aria-label={label}
      class={['size-20 bg-white/5 border border-white/10 text-white/35 text-3xl touch-none active:bg-white/15', cell]}
      onpointerdown={(e) => press(e, direction)}
      onpointerup={() => onmove(direction, false)}
      onpointercancel={() => onmove(direction, false)}
      onlostpointercapture={() => onmove(direction, false)}
      oncontextmenu={(e) => e.preventDefault()}
    >{arrow}</button>
  {/each}
</div>
