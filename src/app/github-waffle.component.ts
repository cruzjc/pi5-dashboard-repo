import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

const DEFAULT_USERNAME = 'cruzjc';
const DEFAULT_COLOR = '00ff41';

@Component({
  selector: 'app-github-waffle',
  imports: [RouterLink],
  templateUrl: './github-waffle.component.html',
  styleUrl: './github-waffle.component.scss'
})
export class GithubWaffleComponent {
  protected readonly username = signal(DEFAULT_USERNAME);

  protected readonly chartUrl = computed(() => {
    const user = encodeURIComponent(this.username().trim() || DEFAULT_USERNAME);
    return `https://ghchart.rshah.org/${DEFAULT_COLOR}/${user}`;
  });

  protected readonly profileUrl = computed(() => {
    const user = encodeURIComponent(this.username().trim() || DEFAULT_USERNAME);
    return `https://github.com/${user}`;
  });
}
