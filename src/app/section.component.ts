import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { SECTIONS } from './sections';

@Component({
  selector: 'app-section',
  imports: [AsyncPipe, RouterLink],
  templateUrl: './section.component.html',
  styleUrl: './section.component.scss'
})
export class SectionComponent {
  private readonly route = inject(ActivatedRoute);

  protected readonly section$ = this.route.paramMap.pipe(
    map((params) => {
      const slug = params.get('slug');
      return SECTIONS.find((entry) => entry.slug === slug) ?? null;
    })
  );
}
