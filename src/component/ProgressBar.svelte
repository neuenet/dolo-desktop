<script>
  /// via https://github.com/saibotsivad/svelte-progress-bar/blob/master/src/ProgressBar.svelte

  // Towards the end of the progress bar animation, we want to shorten the increment
  // step size, to give it the appearance of slowing down. This indicates to the user
  // that progress is still happening, but not as fast as they might like.
  const getIncrement = number => {
    if (number >= 0 && number < 0.2)
      return 0.1;
    else if (number >= 0.2 && number < 0.5)
      return 0.04;
    else if (number >= 0.5 && number < 0.8)
      return 0.02;
    else if (number >= 0.8 && number < 0.99)
      return 0.005;

    return 0;
  };

  // Internal private state.
  let completed = false;
  let running;
  let updater;

  // You'll need to set a color.
  // export let color;

  // You can set the width manually, if you know the percent of completion, but if you're
  // using the start/complete methods you won't need to set this.
  export let width = 0;

  // These are defaults that you shouldn't need to change, but are exposed here in case you do.
  export let minimum = 0.08;
  export let maximum = 0.994;
  export let settleTime = 700;
  export let intervalTime = 700;
  export let stepSizes = [ 0, 0.005, 0.01, 0.02 ];

  // Reset the progress bar back to the beginning, leaving it in a running state.
  export const reset = () => {
    width = minimum;
    running = true;
  };

  // Continue the animation of the progress bar from whatever position it is in, using
  // a randomized step size to increment.
  export const animate = () => {
    if (updater) // prevent multiple intervals by clearing before making
      clearInterval(updater);

    running = true;

    updater = setInterval(() => {
      const randomStep = stepSizes[Math.floor(Math.random() * stepSizes.length)];
      const step = getIncrement(width) + randomStep;

      if (width < maximum)
        width = width + step;

      if (width > maximum) {
        width = maximum;
        stop();
      }
    }, intervalTime);
  };

  // Restart the bar at the minimum, and begin the auto-increment progress.
  export const start = () => {
    reset();
    animate();
  };

  // Stop the progress bar from incrementing, but leave it visible.
  export const stop = () => {
    if (updater)
      clearInterval(updater);
  };

  // Moves the progress bar to the fully completed position, wait an appropriate
  // amount of time so the user can feel the completion, then hide and reset.
  export const complete = () => {
    clearInterval(updater);
    width = 1;
    running = false;

    setTimeout(() => {
      // complete the bar first
      completed = true;

      setTimeout(() => {
        // after some time (long enough to finish the hide animation) reset it back to 0
        completed = false;
        width = 0;
      }, settleTime);
    }, settleTime);
  };

  // Stop the auto-increment functionality and manually set the width of the progress bar.
  export const setWidthRatio = (widthRatio) => {
    stop();
    width = widthRatio;
    completed = false;
    running = true;
  };

  // Primarily used for tests, but can also be used for external monitoring.
  export const getState = () => {
    return {
      // color,
      completed,
      intervalTime,
      maximum,
      minimum,
      running,
      settleTime,
      stepSizes,
      width
    };
  };

  export let barStyle = "";
  // export let leaderColorStyle;

  $: barStyle = /*(color && `background-color: ${color};` || "") +*/ (width && width * 100 && `width: ${width * 100}%;` || "");
  // the box shadow of the leader bar uses `color` to set its shadow color
  // $: leaderColorStyle = color && `background-color: ${color}; color: ${color};` || "";
  //  style={leaderColorStyle}
</script>

<svelte:head>
  <style>
    .svelte-progress-bar, .svelte-progress-bar-leader {
      background-color: var(--dolo-palette-accent);
    }

    .svelte-progress-bar {
      top: 95px; left: 0;

      height: 5px;
      position: fixed;
      transition: width 0.21s ease-in-out;
      z-index: 101;
    }

    .svelte-progress-bar-hiding {
      /*
      top: -8px;
      transition: top 0.8s ease;
      */
      opacity: 0;
      transition: opacity 0.8s ease-out;
    }

    .svelte-progress-bar-leader {
      width: 100px; height: 3px;
      top: 0; right: 0;

      box-shadow: 0 0 8px;
      color: var(--dolo-palette-accent);
      position: absolute;
      transform: rotate(2.5deg) translate(0px, -4px);
      z-index: 2;
    }
  </style>
</svelte:head>

{#if width}
  <aside class="svelte-progress-bar" class:running class:svelte-progress-bar-hiding={completed} style={barStyle}>
    <!-- {#if running}<div class="svelte-progress-bar-leader"></div>{/if} -->
  </aside>
{/if}
