<script>
  import { onMount } from 'svelte';
  import InfoPopup from './components/InfoPopup.svelte';
  import IntroPopup from './components/IntroPopup.svelte';
  import MobileControls from './components/MobileControls.svelte';
  import PausePopup from './components/PausePopup.svelte';
  import { Experience } from './experience/Experience.js';
  import { closeInfo, openInfo, toggleInfo, ui } from './lib/ui.svelte.js';

  let container;
  let bgAudio;
  let experience;

  // Rimuove con fade-out il loading overlay definito in index.html
  function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;
    overlay.style.transition = 'opacity 0.6s ease';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 650);
  }

  function onKeyDown(e) {
    if (e.key.toLowerCase() === 'i') toggleInfo();
  }

  onMount(() => {
    experience = new Experience({ container, bgAudio, ui });
    experience.load()
      .then(hideLoadingOverlay)
      .catch(err => console.error('Errore caricamento dati:', err));

    return () => experience.destroy();
  });
</script>

<svelte:document onkeydown={onKeyDown} />

<!-- Parte muto: l'unmute avviene al primo gesto dell'utente -->
<audio bind:this={bgAudio} loop autoplay muted playsinline>
  <source src="/drone.mp3" type="audio/mpeg">
</audio>

<!-- Il canvas WebGL viene aggiunto in coda a <main> da Experience -->
<main bind:this={container} class="text-stone-300">
  {#if ui.instructions}
    <IntroPopup totalCount={ui.totalCount} snapshotDate={ui.snapshotDate} onstart={() => experience.start()} oninfo={openInfo} />
  {/if}

  {#if ui.info}
    <InfoPopup onclose={closeInfo} />
  {/if}

  {#if ui.touchControls && !ui.info}
    <MobileControls onmove={(direction, pressed) => experience.setMove(direction, pressed)} />
  {/if}

  {#if ui.pause}
    <PausePopup onresume={() => experience.resume()} oninfo={openInfo} />
  {/if}
</main>
